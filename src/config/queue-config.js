const amqplib = require("amqplib")

let channel ,connection;

async function ConnectQueue(){

    try {
        connection = await amqplib.connect('amqp://localhost')
        channel = await connection.createChannel()
        channel.assertQueue('noti-queue')
    } catch (error) {
        console.log(error)
    }
    
}
async function sendData(data){
    try {
        await channel.sendToQueue('noti-queue', Buffer.from(JSON.stringify(data)))
    } catch (error) {
        console.log(error)
    }
}

module.exports = {ConnectQueue, sendData}