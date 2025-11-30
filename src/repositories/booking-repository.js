const { StatusCodes } = require("http-status-codes")
const {Booking} = require("../models")
const { AppError } = require("../utils")
const CrudRepository = require("./crud-repository")

class BookingRepository extends CrudRepository{
    constructor(){
        super(Booking)
    }
    async createBooking(data, transaction){
        try {
            const response = await Booking.create(data, {transaction:transaction})
            return response
        } catch (error) {
            console.log("catching repo")
            throw error
        }
        
    }
    async get(id, transaction){
        const response = await this.model.findbyPk(id, {transaction:transaction})
        if(!response){
            throw new AppError('Not able to find the resource', StatusCodes.NOT_FOUND)
        }
        return response
    }
    async update(id, data, transaction){
        const response = await this.model.update(data,{
            where:{
                id:id
            }
        }, {transaction:transaction})
        if(!response){
            throw new AppError('Not able to update the booking', StatusCodes.NOT_FOUND)
        }
        return response
    }
}

module.exports = BookingRepository