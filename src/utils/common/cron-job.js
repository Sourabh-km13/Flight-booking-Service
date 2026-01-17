const cron = require("node-cron");
const {bookingService} =  require("../../services");

function scheduleTask(){
    cron.schedule('0 * * * *',async()=>{
        const result = await bookingService.cancelOldBooking();
        console.log(result)
    })
}

module.exports = scheduleTask
