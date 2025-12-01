const { default: axios } = require("axios");
const db = require("../models");
const { FlightServiceUrl } = require("../config/server-config");
const { AppError } = require("../utils");
const { StatusCodes } = require("http-status-codes");
const {BookingRepository} = require ("../repositories");
const { Enums } = require("../utils/common");

const {BOOKED,CANCELLED} = Enums.bookingStatus
const bookingRepository= new BookingRepository()

async function createBooking(data) {

    const transaction = await db.sequelize.transaction()
    try {
        const flight = await axios.get(`${FlightServiceUrl}/${data.flightId}`)
        const flightData = flight.data.data
        console.log('flightData',flightData)
        if(data.noOfSeats > flightData.totalSeats){
            throw new AppError('Required no of seats not available',StatusCodes.INTERNAL_SERVER_ERROR)
        }

        const totalCost = flightData.price * data.noOfSeats

        const bookingPayload = {... data, totalCost:totalCost}
        await bookingRepository.createBooking(bookingPayload,transaction)
        await axios.patch(`${FlightServiceUrl}/${data.flightId}`,{
            seat:data.noOfSeats
        })

        await transaction.commit()
        return true
    } catch (error) {
        console.log("catching service")
        await transaction.rollback()
        throw error
    }
    



    
}
async function makePayment(data){
    const transaction = await db.sequelize.transaction();
    try {
        const bookingDetails = await bookingRepository.get(data.bookingId,transaction)
        const bookingTime = new Date(bookingDetails.createdAt);
        const currentTime = new Date()

        if(bookingDetails.userId != data.userId){
            throw new AppError('User of requested booking does not match',StatusCodes.BAD_REQUEST)
        }
        if(bookingDetails.status === CANCELLED ){
            cancelBooking(data.bookingId)
            throw new AppError('Booking time expired',StatusCodes.BAD_REQUEST) 
        }
        if(currentTime-bookingTime > 300000){
            cancelBooking(data.bookingId)
            throw new AppError('Booking time expired',StatusCodes.BAD_REQUEST)
        }
        if(bookingDetails.totalCost != data.totalCost){
            throw new AppError('Amount of requested booking does not match',StatusCodes.BAD_REQUEST)
        }
        
        //assume payment made
        const response = await bookingRepository.update(data.bookingId,{status:BOOKED},{transaction:transaction})
        await transaction.commit()
        return response;
    } catch (error) {
        await transaction.rollback()
        throw error
    }
}

async function cancelBooking(bookingId){
    const transaction = await db.sequelize.transaction();
    try {
        const bookingDetails = await bookingRepository.get(bookingId,transaction)
        if(bookingDetails.status === CANCELLED ){
            await transaction.commit()
            return true
        }   
            await axios.patch(`${FlightServiceUrl}/${bookingDetails.flightId}`,{
            seat:bookingDetails.noOfSeats,
            dec:0
        })  
        await bookingRepository.update(bookingId,{status:CANCELLED},{transaction:transaction})
        await transaction.commit()
    } catch (error) {
        console.log('cancelbookerror',error)
        await transaction.rollBack()
        throw error
    }
}
async function cancelOldBooking(){
    try {
        const timeStamp = new Date(Date.now()-1000*300) //5 mins
        const response = bookingRepository.cancelOldBookings(timeStamp)
        return response
    } catch (error) {
        
    }
}
module.exports = {
    createBooking ,makePayment, cancelOldBooking  
}