const { default: axios } = require("axios");
const db = require("../models");
const { FlightServiceUrl } = require("../config/server-config");
const { AppError } = require("../utils");
const { StatusCodes } = require("http-status-codes");
const {BookingRepository} = require ("../repositories")

const bookingRepository= new BookingRepository()

async function createBooking(data) {

    const transaction = db.sequelize.transaction()
    try {
        const flight = await axios.get(`${FlightServiceUrl}/${data.flightId}`)
        const flightData = flight.data.data
        console.log('flightData',flightData)
        if(data.noOfSeats > flightData.totalSeats){
            throw new AppError('Required no of seats not available',StatusCodes.INTERNAL_SERVER_ERROR)
        }

        const totalCost = flightData.price * data.noOfSeats

        const bookingPayload = {... data, totalCost:totalCost}
        bookingRepository.create(bookingPayload)

        await transaction.commit()
        return true
    } catch (error) {
        await transaction.rollback()
    }
    



    
}

module.exports = {
    createBooking   
}