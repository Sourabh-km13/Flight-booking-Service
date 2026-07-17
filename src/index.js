const express = require('express');

const { ServerConfig, Queue } = require('./config');
const apiRoutes = require('./routes');
const Crons = require('./utils/common/cron-job');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Booking Service is healthy'
    });
});

app.use('/api', apiRoutes);

app.listen(ServerConfig.PORT, () => {
    console.log(`Successfully started the server on PORT : ${ServerConfig.PORT}`);
    Queue.ConnectQueue()
    console.log('queue connected')
    Crons()
});
