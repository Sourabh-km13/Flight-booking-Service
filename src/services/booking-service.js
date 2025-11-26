const { default: axios } = require("axios");
const db = require("../models");
const { FlightServiceUrl } = require("../config/server-config");
const { AppError } = require("../utils");
const { StatusCodes } = require("http-status-codes");


async function createBooking(data) {
    return new Promise((res , rej)=>{
        const result = db.sequelize.transaction(async function bookingImpl(t){
            const flight = await axios.get(`${FlightServiceUrl}/${data.flightId}`)
            const flightData = flight.data.data
            console.log('flightData',flightData)
            if(data.noOfSeats > flightData.totalSeats){
                rej(new AppError('Required no of seats not available',StatusCodes.INTERNAL_SERVER_ERROR))
            }
            res(true)
        })
    })
    
}

module.exports = {
    createBooking   
}