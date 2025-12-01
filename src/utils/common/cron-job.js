const cron = require("node-cron");
const {bookingService} =  require("../../services");

function scheduleTask(){
    cron.schedule('* * * * * *',async()=>{
        const result = await bookingService.cancelOldBooking();
        console.log(result)
    })
}

module.exports = scheduleTask
