const dotenv = require('dotenv');

dotenv.config();

module.exports = {
    PORT: process.env.PORT,
    FlightServiceUrl:process.env.FLIGHT_SERVICE_URL
}