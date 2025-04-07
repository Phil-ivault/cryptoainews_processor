import dotenv from 'dotenv';
dotenv.config();

// Check only for the specific flag this script cares about
if (process.env.DO_FLUSH_REDIS === 'true') {
    console.warn('🚨 PRESTART WARNING: DO_FLUSH_REDIS is enabled - Redis will be wiped on next deploy/start.');
}

// No other validation needed here, server.js handles required vars for startup.
console.log("ℹ️ Prestart checks complete.");