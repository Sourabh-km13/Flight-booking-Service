const dotenv = require('dotenv');

dotenv.config();

module.exports = {
    PORT: process.env.PORT,
    FlightServiceUrl: process.env.FLIGHT_SERVICE_URL,
    RABBITMQ_URL: process.env.RABBITMQ_URL,
    DB_USER: process.env.DB_USER,
    DB_PASS: process.env.DB_PASS,
    DB_NAME: process.env.DB_NAME,
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_DIALECT: process.env.DB_DIALECT
}
