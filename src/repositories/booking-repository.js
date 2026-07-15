const { StatusCodes } = require("http-status-codes")
const {Booking} = require("../models")
const { AppError } = require("../utils")
const CrudRepository = require("./crud-repository")
const { Op } = require("sequelize")
const { Enums } = require("../utils/common")
const {INITIATED,PENDING} = Enums.bookingStatus

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
        const response = await this.model.findByPk(id, {transaction:transaction})
        if(!response){
            throw new AppError('Not able to find the resource', StatusCodes.NOT_FOUND)
        }
        return response
    }
    async getByUserId(userId, filters = {}){
        const where = {userId:userId}

        if(filters.status){
            where.status = filters.status
        }

        const response = await this.model.findAll({
            where,
            order:[['createdAt','DESC']]
        })
        return response
    }
    async update(id, data, transaction){
        const options = {
            where:{
                id:id
            }
        }

        if(transaction){
            options.transaction = transaction
        }

        const response = await this.model.update(data,options)
        if(!response[0]){
            throw new AppError('Not able to update the booking', StatusCodes.NOT_FOUND)
        }
        return response
    }
    async getExpiredUnpaidBookings(timeStamp){
        const response = await Booking.findAll({
            where:{
                createdAt:{
                    [Op.lt]:timeStamp
                },
                status:{
                    [Op.in]:[INITIATED,PENDING]
                }
            },
            order:[['createdAt','ASC']]
        })
        return response
    }
}

module.exports = BookingRepository