const axios = require('axios');
const { FlightServiceUrl } = require('../../config/server-config');

const flightAxios = axios.create({
    baseURL: FlightServiceUrl
});

async function getFlight(flightId) {
    const response = await flightAxios.get(`/api/v1/flight/${flightId}`);
    return response.data.data;
}

async function updateSeats(flightId, data) {
    const response = await flightAxios.patch(`/api/v1/flight/${flightId}`, data);
    return response.data.data;
}

module.exports = {
    getFlight,
    updateSeats
};
