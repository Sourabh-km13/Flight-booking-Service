# Booking Service — FlySmart

The Booking Service manages the **ticket booking lifecycle** for FlySmart. It creates a temporary seat hold, provides a limited payment window, confirms successful bookings, and automatically expires unpaid reservations, releasing seats back to the Flight Service.

Following the database-per-service pattern, it maintains its own MySQL database and does not store user identities or flight catalog data. User authentication is delegated to the API Gateway, while seat inventory is managed by the Flight Service. The Booking Service coordinates with these services through synchronous HTTP APIs and asynchronous RabbitMQ messaging to ensure reliable booking and notification workflows.

![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-Sequelize-4479A1?logo=mysql&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ-amqplib-FF6600?logo=rabbitmq&logoColor=white)
![node-cron](https://img.shields.io/badge/Jobs-node--cron-35495E)
![Axios](https://img.shields.io/badge/HTTP-Axios-5A29E4?logo=axios&logoColor=white)

> **Part of the FlySmart platform** · [Overview](../README.md) · [Live demo](https://flight-frontend-eight.vercel.app/) · [Frontend](../Flight-Frontend) · [API Gateway](../Api_Gateway_Flight) · [Flight Service](../Flight-Service)

### Skills demonstrated

- **Cross-service transactions** — a seat-hold saga that reserves inventory in the Flight Service and compensates (restores seats) on failure or expiry.
- **Asynchronous messaging** — decoupling ticket email from the payment request via a RabbitMQ queue.
- **Scheduled jobs** — a `node-cron` sweeper that reconciles abandoned holds every minute.
- **Data ownership** — an isolated MySQL schema with logical (not SQL) references to other services.
- **Resilient HTTP integration** — a dedicated Flight Service client with graceful enrichment fallbacks.

---

## Architecture

```text
                    JWT (via Gateway)
                           │
                           ▼
              ┌────────────────────────┐
              │     Booking Service    │
              │  create / pay / read   │
              │  cron expiry cleanup   │
              └───────────┬────────────┘
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
   MySQL Bookings   Flight Service    RabbitMQ
   (local state)    GET flight        noti-queue
                    PATCH seats       (ticket mail)
```

| Neighbor | Relationship |
|----------|----------------|
| **API Gateway** | Clients reach this service through `/bookingservice` (auth required). Path rewrite strips that prefix. |
| **Flight Service** | Source of flight price, remaining seats, and seat reserve/restore. |
| **RabbitMQ** | After a successful payment, booking confirmation mail is **queued** asynchronously — not sent inside the HTTP request. |

---

## How a booking works

This is the core story of the service.

### 1. Create a hold

`POST /api/v1/booking` with `flightId`, `userId`, and `noOfSeats`.

1. Fetch the flight from Flight Service.
2. Reject the request if requested seats exceed `totalSeats`.
3. Compute `totalCost = price × noOfSeats`.
4. Insert a booking row with status **`initiated`** (inside a DB transaction).
5. PATCH Flight Service to **decrement** remaining seats for this hold.
6. Commit and return the booking.

At this point seats are reserved, but the ticket is not confirmed yet.

### 2. Pay within five minutes

`POST /api/v1/booking/payment` with `bookingId`, `userId`, and `totalCost`.

1. Load the booking and verify the payer matches `userId`.
2. Verify `totalCost` matches the stored amount.
3. Enforce a **5-minute payment window** from `createdAt` (`300000` ms).
4. If the window has already expired, cancel the hold (restore seats) and reject payment.
5. Mark the booking **`booked`**.
6. Publish a confirmation-mail message to RabbitMQ queue **`noti-queue`**.
7. Commit.

Payment is treated as an application-level confirmation step (no third-party payment provider in this service).

### 3. What happens if nobody pays

A cron job runs **every minute**. It finds unpaid holds older than five minutes and cancels them:

- status becomes **`cancelled`**
- seats are restored on Flight Service (increment)
- confirmed **`booked`** tickets are never touched by expiry

The frontend mirrors the same five-minute window with a payment countdown.

---

## Tech stack

| Concern | Choice |
|---------|--------|
| HTTP API | Node.js, Express |
| Persistence | Sequelize + MySQL |
| Flight coordination | Axios instance in `src/utils/common/flight-service.js` |
| Background expiry | `node-cron` (every minute) |
| Async ticket mail | `amqplib` → RabbitMQ `noti-queue` |
| Logging | Winston |

---

## API reference

Service routes live under `/api/v1`. Through the gateway, callers use:

```text
/bookingservice/api/v1/...
```

| Method | Path | Body / params | What it does |
|--------|------|---------------|--------------|
| GET | `/health` | — | Unauthenticated liveness check (`GET /health`, outside `/api/v1`) |
| GET | `/api/v1/info` | — | Info endpoint |
| POST | `/booking` | `{ flightId, userId, noOfSeats }` | Create hold + reserve seats |
| POST | `/booking/payment` | `{ bookingId, userId, totalCost, userEmail? }` | Confirm booking + enqueue ticket mail |
| GET | `/booking/user/:userId` | query `?status=` optional | List user bookings (+ flight details) |
| GET | `/booking/:id` | — | Single booking (+ flight details) |

There is **no public cancel HTTP endpoint**. Cancellation runs internally via the expiry cron or when a late payment attempt triggers cleanup.

### Example: create booking

```http
POST /bookingservice/api/v1/booking
x-access-token: <jwt>
Content-Type: application/json

{
  "flightId": 12,
  "userId": 3,
  "noOfSeats": 2
}
```

Successful create returns the booking row (status `initiated`, computed `totalCost`, timestamps).

### Example: confirm payment

```http
POST /bookingservice/api/v1/booking/payment
x-access-token: <jwt>
Content-Type: application/json

{
  "bookingId": 45,
  "userId": 3,
  "totalCost": 8000,
  "userEmail": "traveler@example.com"
}
```

On success the booking becomes `booked` and, when `userEmail` is provided, a mail message is published to RabbitMQ. Read APIs return the booking plus an embedded `flight` object from Flight Service (or `flight: null` if that fetch fails).

---

## Lifecycle and timings

Statuses (ENUM): `initiated` · `pending` · `booked` · `cancelled`

| From | To | When |
|------|----|------|
| — | `initiated` | Create booking |
| `initiated` | `booked` | Payment succeeds within 5 minutes |
| `initiated` | `cancelled` | Cron expiry, or late payment cleanup |
| `booked` | — | Expiry job refuses to cancel confirmed tickets |

```text
          create
            │
            ▼
        initiated ──────────── pay ≤ 5 min ──────────► booked
            │                                            │
            │                                            ▼
            │                                   RabbitMQ noti-queue
            │                                   (async ticket email)
            │
            └── older than 5 min (cron / late pay) ──► cancelled
                                                       (+ seats restored)
```

**Note:** `pending` exists in the ENUM for compatibility, but create always writes `initiated` today. The cron still includes `pending` when sweeping expired unpaid holds.

| Timer | Value |
|-------|--------|
| Payment window | 5 minutes (`300000` ms from `createdAt`) |
| Cron schedule | every minute (`* * * * *`) |
| Expiry cutoff | `createdAt < now - 5 minutes` and status in `initiated` / `pending` |

---

## Inventory coordination with Flight Service

All Flight Service calls go through a single Axios instance in [`src/utils/common/flight-service.js`](src/utils/common/flight-service.js), configured with `baseURL: FLIGHT_SERVICE_URL`. `FLIGHT_SERVICE_URL` is the Flight Service **base URL** (no path); the resource path (`/api/v1/flight/...`) is appended by the client helper.

```bash
FLIGHT_SERVICE_URL=http://localhost:<flight-port>
```

| Action | Client call | HTTP | Purpose |
|--------|-------------|------|---------|
| Read flight | `FlightService.getFlight(id)` | `GET /api/v1/flight/:id` | Price, seats, enrichment |
| Reserve seats | `FlightService.updateSeats(id, { seat, dec: 0 })` | `PATCH /api/v1/flight/:id` | Hold inventory on create |
| Restore seats | `FlightService.updateSeats(id, { seat, dec: 1 })` | `PATCH /api/v1/flight/:id` | Release inventory on cancel |

Seat patch body:

```json
{ "seat": <noOfSeats>, "dec": 0 | 1 }
```

| `dec` | Meaning in Flight Service | Used by Booking Service |
|-------|---------------------------|-------------------------|
| `0` | Decrement remaining seats | Create hold |
| `1` | Increment remaining seats | Cancel / expiry restore |

Flight Service applies these updates under its own locking (`SELECT … FOR UPDATE`), which is why holds and restores stay safe under concurrent bookings.

---

## Asynchronous ticket email (RabbitMQ)

Booking confirmation mail is **not** sent inside the payment request. After status flips to `booked`, and only when the request included a `userEmail`, the service publishes a JSON message to RabbitMQ so a separate notification consumer can send email asynchronously.

| Detail | Value |
|--------|--------|
| Library | `amqplib` |
| Broker | `RABBITMQ_URL` env (e.g. `amqp://localhost` or a hosted broker) |
| Queue | `noti-queue` |
| When | Successful `makePayment` with a `userEmail`, after status → `booked` |
| Why | Keep payment fast; isolate SMTP/provider failures from booking confirmation |

Published payload shape:

```json
{
  "recepientEmail": "traveler@example.com",
  "subject": "Flight booked",
  "text": "Booking successfully done for the booking <bookingId>"
}
```

The recipient address comes from the `userEmail` on the payment request (the queue field is spelled `recepientEmail` in code). Publishing is skipped gracefully if no `userEmail` is provided or the RabbitMQ channel is not ready, so payment never fails because the broker is down. A notification worker consuming `noti-queue` is expected to send the actual email.

Why this design works well:

- Payment API does not wait on mail delivery latency
- Mail sending can be retried by the consumer without rolling back a confirmed booking
- Clear separation between **booking domain** and **notification delivery**

---

## Expiry cron

File: `src/utils/common/cron-job.js`

On startup (`src/index.js`), after the HTTP server listens, the service:

1. Connects to RabbitMQ (`Queue.ConnectQueue()`)
2. Starts the cron scheduler

Each minute it calls `cancelOldBooking()`:

1. Select unpaid bookings older than five minutes (`initiated` / `pending`)
2. For each booking, run internal `cancelBooking(id)`
3. Skip if already `cancelled`
4. Refuse if status is `booked`
5. Otherwise PATCH Flight Service with `dec: 1` and set status `cancelled`

This keeps inventory honest when travelers abandon checkout.

---

## Data model

Table: **Bookings** (own MySQL schema; no SQL foreign keys to Gateway or Flight Service)

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `flightId` | INTEGER | Logical reference → Flight Service `Flights.id` |
| `userId` | INTEGER | Logical reference → Gateway `Users.id` |
| `status` | ENUM | `booked`, `cancelled`, `pending`, `initiated` (default `initiated` in model) |
| `noOfSeats` | INTEGER | Required |
| `totalCost` | INTEGER | `flight.price * noOfSeats` at create time |
| `createdAt` / `updatedAt` | DATE | Drive payment window + cron cutoff |

```text
Gateway Users.id  ·····  Bookings.userId
Flight Flights.id ·····  Bookings.flightId
```

Flight details are attached at read time via HTTP (`addFlightDetails`), not via joins. That keeps catalog ownership in Flight Service and avoids duplicating schedule data here.

---

## Consistency notes

- Create, payment, and cancel wrap **local** DB work in Sequelize transactions.
- Seat reserve/restore is a **remote** Flight Service call. If the remote call and local commit diverge, inventory and booking state can temporarily disagree — a known distributed-systems tradeoff in this design.
- RabbitMQ publish happens during payment before commit; a notification consumer should treat mail delivery as best-effort relative to booking state.

---

## Configuration and run

### Environment

All configuration is env-driven via `.env` (loaded by `dotenv`). Sequelize reads the same values through `src/config/config.js` (no committed `config.json`).

```bash
PORT=4000
FLIGHT_SERVICE_URL=http://localhost:3000       # Flight Service base URL (no path)
RABBITMQ_URL=amqp://localhost                  # or a hosted broker
DB_USER=root
DB_PASS=
DB_NAME=Bookings
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DIALECT=mysql
```

See [`.env.example`](.env.example) for the full template.

### Prerequisites

- MySQL running and the `Bookings` database created
- Flight Service reachable at `FLIGHT_SERVICE_URL`
- A RabbitMQ broker at `RABBITMQ_URL` if you want async booked-ticket emails (optional; publishing is skipped gracefully when unavailable)

### Commands

```bash
npm install
npx sequelize-cli db:migrate
npm run dev      # nodemon (local)
npm start        # node src/index.js (production)
```

Point the gateway `BOOKING_SERVICE` env var at this service’s base URL (for example `http://localhost:4000`).

---

## Project layout

```text
src/
  index.js                 # Express boot → /health → ConnectQueue → cron
  config/
    server-config.js       # PORT, FLIGHT_SERVICE_URL, RABBITMQ_URL, DB_*
    config.js              # Sequelize config sourced from env (no config.json)
    queue-config.js        # RabbitMQ connect + guarded sendData
    logger-config.js       # Winston
  routes/v1/
    booking-routes.js      # booking + payment + reads
  controllers/             # HTTP adapters
  services/
    booking-service.js     # create, pay, cancel, enrich, expiry
  repositories/            # Booking persistence helpers
  models/booking.js
  migrations/              # Bookings table
  utils/common/
    flight-service.js      # Axios instance → Flight Service (getFlight, updateSeats)
    cron-job.js            # every-minute expiry sweeper
    enums.js               # booking statuses
.sequelizerc               # points sequelize-cli at src/config/config.js
```

---

## Related services

| Repo | Role |
|------|------|
| [FlySmart overview](../README.md) | Platform overview + live demo |
| [Api_Gateway_Flight](../Api_Gateway_Flight) | Auth + reverse proxy to `/bookingservice` |
| [Flight-Service](../Flight-Service) | Flight catalog and locked seat inventory |
| [Flight-Frontend](../Flight-Frontend) | Booking UI and five-minute payment timer |

---

## License

Released under the MIT License.
