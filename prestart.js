import dotenv from 'dotenv';

// Load environment variables from the .env file.
dotenv.config();

/**
 * Pre-start Check Script
 *
 * This script runs before the main server starts (via npm's 'prestart' hook).
 * Its purpose is to perform quick checks or show warnings based on
 * environment variable settings.
 */

// Check if the 'DO_FLUSH_REDIS' flag is set to 'true'.
// This is a potentially destructive action, so a warning is shown.
if (process.env.DO_FLUSH_REDIS === 'true') {
    console.warn('🚨 PRESTART WARNING: DO_FLUSH_REDIS is enabled - Redis will be wiped on next start!');
}

// More checks can be added here if needed in the future.

// Log completion of pre-start checks.
// Note: More comprehensive validation happens in server.js.
console.log("ℹ️ Prestart checks complete.");