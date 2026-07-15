const express = require('express')
const { BookingController } = require('../../controllers')

const bookingRouter = express.Router()

bookingRouter.post('/',BookingController.createBooking)
bookingRouter.post('/payment',BookingController.makePayment)
bookingRouter.get('/user/:userId',BookingController.getBookingsByUserId)
bookingRouter.get('/:id',BookingController.getBooking)

module.exports = bookingRouter