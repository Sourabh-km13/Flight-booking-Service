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

module.exports = {createBooking}