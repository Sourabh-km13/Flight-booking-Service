const {
    DB_USER,
    DB_PASS,
    DB_NAME,
    DB_HOST,
    DB_PORT,
    DB_DIALECT
} = require('./server-config');

module.exports = {
    development: {
        username: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        host: DB_HOST,
        port: DB_PORT,
        dialect: DB_DIALECT
    },
    test: {
        username: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        host: DB_HOST,
        port: DB_PORT,
        dialect: DB_DIALECT
    },
    production: {
        username: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        host: DB_HOST,
        port: DB_PORT,
        dialect: DB_DIALECT
    }
};
