const { StatusCodes } = require("http-status-codes");
const { bookingService } = require("../services");
const { failResponse, successResponse } = require("../utils/common");
const { AppError } = require("../utils");

async function createBooking(req, res){
    try {
        const response = await bookingService.createBooking({
            flightId:req.body.flightId,
            userId:req.body.userId,
            noOfSeats: req.body.noOfSeats
        })
        successResponse.data = response
        res.status(StatusCodes.CREATED).json(successResponse)
    } catch (error) {
        console.log("catching controller",error)
        if(error instanceof AppError){
            failResponse.data = error
            res.status(error.statusCode).json({
                failResponse
            })
        }
        else{
            failResponse.message = error.message
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                failResponse
            })
        }
    }
    
}

async function makePayment(req, res){
    try {
        const response = await bookingService.makePayment({
            totalCost:req.body.totalCost,
            userId:req.body.userId,
            bookingId: req.body.bookingId
        })
        successResponse.data = response
        res.status(StatusCodes.CREATED).json(successResponse)
    } catch (error) {
        console.log(error)
        if(error instanceof AppError){
            failResponse.data = error
            res.status(error.statusCode).json({
                failResponse
            })
        }
        else{
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                failResponse
            })
        }
    }
    
}

async function getBooking(req, res){
    try {
        const response = await bookingService.getBooking(req.params.id)
        successResponse.data = response
        res.status(StatusCodes.OK).json(successResponse)
    } catch (error) {
        console.log(error)
        if(error instanceof AppError){
            failResponse.data = error
            res.status(error.statusCode).json({
                failResponse
            })
        }
        else{
            failResponse.message = error.message
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                failResponse
            })
        }
    }
}

async function getBookingsByUserId(req, res){
    try {
        const response = await bookingService.getBookingsByUserId(req.params.userId, {
            status:req.query.status
        })
        successResponse.data = response
        res.status(StatusCodes.OK).json(successResponse)
    } catch (error) {
        console.log(error)
        if(error instanceof AppError){
            failResponse.data = error
            res.status(error.statusCode).json({
                failResponse
            })
        }
        else{
            failResponse.message = error.message
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                failResponse
            })
        }
    }
}

module.exports = {createBooking, makePayment, getBooking, getBookingsByUserId}