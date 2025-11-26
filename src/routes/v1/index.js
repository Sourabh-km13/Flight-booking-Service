const express = require('express');

const { InfoController } = require('../../controllers');
const bookingRouter = require('./booking-routes');

const router = express.Router();

router.get('/info', InfoController.info);

router.use('/booking',bookingRouter)

module.exports = router;