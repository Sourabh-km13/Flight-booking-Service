const db = require("../models");
const { AppError } = require("../utils");
const { StatusCodes } = require("http-status-codes");
const {BookingRepository} = require ("../repositories");
const { Enums, FlightService } = require("../utils/common");
const { Queue } = require("../config");

const {BOOKED,CANCELLED,INITIATED} = Enums.bookingStatus
const bookingRepository= new BookingRepository()

async function addFlightDetails(booking) {
    try {
        const flight = await FlightService.getFlight(booking.flightId)
        return {
            ...booking.toJSON(),
            flight
        }
    } catch (error) {
        return {
            ...booking.toJSON(),
            flight: null
        }
    }
}

async function createBooking(data) {
    let seatsReserved = false
    const transaction = await db.sequelize.transaction()
    try {
        const flightData = await FlightService.getFlight(data.flightId)
        const totalCost = flightData.price * data.noOfSeats

        await FlightService.updateSeats(data.flightId, {
            seat: data.noOfSeats,
            dec: 0,
        })
        seatsReserved = true

        const bookingPayload = { ...data, totalCost }
        const response = await bookingRepository.createBooking(bookingPayload, transaction)
        await transaction.commit()
        return response
    } catch (error) {
        await transaction.rollback()

        if (seatsReserved) {
            try {
                await FlightService.updateSeats(data.flightId, {
                    seat: data.noOfSeats,
                    dec: 1,
                })
            } catch (restoreError) {
                console.log('Failed to restore seats after booking create failure', restoreError)
            }
        }

        if (error instanceof AppError) {
            throw error
        }

        const status = error.response?.status
        const message =
            error.response?.data?.failResponse?.data?.explanation ||
            error.response?.data?.failResponse?.data?.message ||
            error.response?.data?.message ||
            error.message

        if (status === StatusCodes.BAD_REQUEST || status === StatusCodes.CONFLICT) {
            throw new AppError(message || 'Required no of seats not available', StatusCodes.BAD_REQUEST)
        }
        if (status === StatusCodes.NOT_FOUND) {
            throw new AppError(message || 'Flight not found', StatusCodes.NOT_FOUND)
        }

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
        if(bookingDetails.status === BOOKED){
            await transaction.commit()
            return bookingDetails
        }
        if(bookingDetails.status === CANCELLED ){
            throw new AppError('Booking time expired',StatusCodes.BAD_REQUEST) 
        }
        if(currentTime-bookingTime > 300000 && bookingDetails.status===INITIATED){
            await cancelBooking(data.bookingId)
            throw new AppError('Booking time expired',StatusCodes.BAD_REQUEST)
        }
        if(bookingDetails.totalCost != data.totalCost){
            throw new AppError('Amount of requested booking does not match',StatusCodes.BAD_REQUEST)
        }
        
        //assume payment made
        const response = await bookingRepository.update(data.bookingId,{status:BOOKED},transaction)
        if (data.userEmail) {
            Queue.sendData({
                recepientEmail: data.userEmail,
                subject: 'Flight booked',
                text: `Booking successfully done for the booking ${data.bookingId}`
            })
        }
        await transaction.commit()
        return response;
    } catch (error) {
        await transaction.rollback()
        throw error
    }
}

async function getBooking(bookingId){
    const booking = await bookingRepository.get(bookingId)
    return addFlightDetails(booking)
}

async function getBookingsByUserId(userId, filters = {}){
    const bookings = await bookingRepository.getByUserId(userId, filters)
    const bookingsWithFlights = await Promise.all(bookings.map((booking) => addFlightDetails(booking)))
    return bookingsWithFlights
}

async function cancelBooking(bookingId){
    const transaction = await db.sequelize.transaction();
    try {
        const bookingDetails = await bookingRepository.get(bookingId,transaction)
        if(bookingDetails.status === CANCELLED ){
            await transaction.commit()
            return true
        }   
        if(bookingDetails.status === BOOKED ){
            throw new AppError('Booked tickets cannot be cancelled by expiry job',StatusCodes.BAD_REQUEST)
        }
        await FlightService.updateSeats(bookingDetails.flightId, {
            seat: bookingDetails.noOfSeats,
            dec: 1
        })  
        await bookingRepository.update(bookingId,{status:CANCELLED},transaction)
        await transaction.commit()
        return true
    } catch (error) {
        console.log('cancelbookerror',error)
        await transaction.rollback()
        throw error
    }
}
async function cancelOldBooking(){
    try {
        const timeStamp = new Date(Date.now()-1000*300) //5 mins
        const expiredBookings = await bookingRepository.getExpiredUnpaidBookings(timeStamp)
        const response = await Promise.all(expiredBookings.map((booking) => cancelBooking(booking.id)))
        return response
    } catch (error) {
        throw error
    }
}
module.exports = {
    createBooking ,makePayment, getBooking, getBookingsByUserId, cancelOldBooking  
}
