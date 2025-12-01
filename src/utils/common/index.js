const Enum = require('./enums')
const fail = require("./fail-response");
const  success  = require("./success-response");

module.exports={
    successResponse : success,
    failResponse:fail,
    Enums:Enum,

}