// 1. Immediate error handling at the very top to catch ANY require failures
process.on('uncaughtException', (err) => {
    console.error('CRITICAL STARTUP ERROR - UNCAUGHT EXCEPTION! 💥');
    console.error(err.name, ': ', err.message);
    console.error(err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL STARTUP ERROR - UNHANDLED REJECTION! 💥');
    console.error(reason);
    process.exit(1);
});

console.log('--- STARTING HOMEVED API ---');
console.log('Node Version:', process.version);
console.log('CWD:', process.cwd());

let app;
try {
    require('dotenv').config();
    app = require('./app');
    console.log('✅ App module loaded successfully');
} catch (err) {
    console.error('💥 FAILED TO INITIALIZE APP MODULE:', err);
    process.exit(1);
}

const PORT = process.env.PORT || 4000;

// Only start the server if we're not running as a module (e.g., on Vercel)
// Vercel imports the app and handles the listen part itself.
if (require.main === module) {
    const server = app.listen(PORT, () => {
        console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    }).on('error', (err) => {
        console.error('❌ Server startup error:', err);
        process.exit(1);
    });
} else {
    console.log('ℹ️ Server running in serverless/module mode');
}

module.exports = app;
