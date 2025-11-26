const {Bookings} = require("../models")
const CrudRepository = require("./crud-repository")

class BookingRepository extends CrudRepository{
    constructor(){
        super(Bookings)
    }
}

module.exports = BookingRepository