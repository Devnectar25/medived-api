const app = require('./app');
const pool = require('./config/db');
require('dotenv').config();

const PORT = process.env.PORT || 4000;

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    process.exit(1);
});

// Test DB Connection
pool.connect().then(client => {
    console.log('✅ Database connected successfully');
    client.release();
}).catch(err => {
    console.error('❌ Database connection failed', err.stack);
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});
