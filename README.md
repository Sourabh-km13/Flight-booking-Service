# Booking Service — FlySmart

The Booking Service manages the **ticket booking lifecycle** for FlySmart. It creates a temporary seat hold, provides a limited payment window, confirms successful bookings, and automatically expires unpaid reservations, releasing seats back to the Flight Service.

Following the database-per-service pattern, it maintains its own MySQL database and does not store user identities or flight catalog data. User authentication is delegated to the API Gateway, while seat inventory is managed by the Flight Service. The Booking Service coordinates with these services through synchronous HTTP APIs and asynchronous RabbitMQ messaging to ensure reliable booking and notification workflows.

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
| Flight coordination | Axios |
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
| GET | `/info` | — | Health/info |
| POST | `/booking` | `{ flightId, userId, noOfSeats }` | Create hold + reserve seats |
| POST | `/booking/payment` | `{ bookingId, userId, totalCost }` | Confirm booking + enqueue ticket mail |
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
  "totalCost": 8000
}
```

On success the booking becomes `booked` and a mail message is published to RabbitMQ. Read APIs return the booking plus an embedded `flight` object from Flight Service (or `flight: null` if that fetch fails).

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

Configured by `FLIGHT_SERVICE_URL`, expected to point at the flight resource base, for example:

```bash
FLIGHT_SERVICE_URL=http://localhost:<flight-port>/api/v1/flight
```

| Action | HTTP call | Purpose |
|--------|-----------|---------|
| Read flight | `GET ${FLIGHT_SERVICE_URL}/:flightId` | Price, seats, enrichment |
| Reserve seats | `PATCH ${FLIGHT_SERVICE_URL}/:flightId` | Hold inventory on create |
| Restore seats | `PATCH ${FLIGHT_SERVICE_URL}/:flightId` | Release inventory on cancel |

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

Booking confirmation mail is **not** sent inside the payment request. After status flips to `booked`, the service publishes a JSON message to RabbitMQ so a separate notification consumer can send email asynchronously.

| Detail | Value |
|--------|--------|
| Library | `amqplib` |
| Broker | `amqp://localhost` (hardcoded in queue config) |
| Queue | `noti-queue` |
| When | Successful `makePayment`, after status → `booked` |
| Why | Keep payment fast; isolate SMTP/provider failures from booking confirmation |

Published payload shape:

```json
{
  "recepientEmail": "lordgk02@mail.com",
  "subject": "Flight booked",
  "text": "Booking successfully done for the booking <bookingId>"
}
```

Today the recipient address is **hardcoded** in the payment path (field name is spelled `recepientEmail` in code). A notification worker consuming `noti-queue` is expected to send the actual email.

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

`.env`:

```bash
PORT=4000
FLIGHT_SERVICE_URL=http://localhost:<flight-port>/api/v1/flight
```

### Sequelize config

Create `src/config/config.json` (gitignored) with MySQL credentials for `development` / `production`, same pattern as the other services.

### Prerequisites

- MySQL running and database created
- Flight Service reachable at `FLIGHT_SERVICE_URL`
- RabbitMQ running locally if you want async booked-ticket emails (`amqp://localhost`)

### Commands

```bash
npm install
npx sequelize-cli db:migrate
npm run dev
```

Point the gateway `BOOKING_SERVICE` env var at this service’s base URL (for example `http://localhost:4000`).

---

## Project layout

```text
src/
  index.js                 # Express boot → ConnectQueue → cron
  config/
    server-config.js       # PORT, FLIGHT_SERVICE_URL
    queue-config.js        # RabbitMQ connect + sendData
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
    cron-job.js            # every-minute expiry sweeper
    enums.js               # booking statuses
```

---

## Related services

| Repo | Role |
|------|------|
| [Api_Gateway_Flight](../Api_Gateway_Flight) | Auth + reverse proxy to `/bookingservice` |
| [Flight-Service](../Flight-Service) | Flight catalog and locked seat inventory |
| [Flight-Frontend](../Flight-Frontend) | Booking UI and five-minute payment timer |

---

## License

Private / educational project.
