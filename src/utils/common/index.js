const Enum = require('./enums')
const fail = require("./fail-response");
const  success  = require("./success-response");
const FlightService = require('./flight-service');

module.exports={
    successResponse : success,
    failResponse:fail,
    Enums:Enum,
    FlightService
}