import dotenv from 'dotenv';
import app from './app.js'; // Import the configured Express app.
// Import service initializers and utilities.
import { initializeSystem as initializeTelegramSystem } from './src/services/telegramService.js';
import { redisClient, connectRedis } from './utils/redis.js'; //
import { startPricePolling } from './src/services/priceService.js';
import { startWebhookService } from './src/services/webhookService.js';

// Load environment variables from .env file into process.env.
dotenv.config();

/**
 * Validates that all essential environment variables are set.
 * Throws an error if any required variable is missing, preventing startup.
 */
const validateEnvironment = () => {
  const requiredVars = [
    'TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION_STRING', 'TELEGRAM_CHANNEL',
    'REDIS_URL',
    'OPENROUTER_API_KEYS',
    'SITE_URL' // Crucial for CORS and OpenRouter headers.
  ];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    throw new Error(`💥 Missing required environment variables: ${missingVars.join(', ')}`);
  }
  console.log('✅ Core environment variables validated.');
};

/**
 * Flushes the Redis database if the DO_FLUSH_REDIS environment variable is set to 'true'.
 * This is a maintenance task and should be used with extreme caution.
 */
const handleRedisFlush = async () => {
  if (process.env.DO_FLUSH_REDIS === 'true') {
    console.warn('🚨 WARNING: DO_FLUSH_REDIS is true. Flushing Redis database NOW...');
    try {
      await redisClient.flushDb();
      console.log('✅ Redis database flushed.');
      // IMPORTANT: Recommend setting DO_FLUSH_REDIS to false after this.
      console.warn('ℹ️ Remember to set DO_FLUSH_REDIS back to false in your environment!');
    } catch (flushError) {
      console.error('💥 Failed to flush Redis:', flushError);
      // Decide if this should prevent startup. For now, we continue but warn.
    }
  }
};

/**
 * Main server startup function.
 * It coordinates environment validation, Redis connection, service initialization,
 * and finally starts the HTTP server.
 */
const startServer = async () => {
  try {
    // --- Phase 1: Environment Validation ---
    validateEnvironment();

    // --- Phase 2: Redis Initialization & Maintenance ---
    console.log('⏳ Connecting to Redis...');
    await connectRedis(); // Establish connection to Redis.
    await handleRedisFlush(); // Check if Redis needs to be flushed.

    // --- Phase 3: Initialize Services & Start Background Tasks ---

    // 3a. Price Service: Starts polling for cryptocurrency prices.
    console.log('⏳ Starting price polling service...');
    startPricePolling();

    // 3b. Telegram System: Initializes the API ID counter and performs initial fetches.
    console.log('⏳ Initializing Telegram system and starting polling...');
    // This now includes both initialization and starting the polling loop.
    await initializeTelegramSystem();

    // 3c. Webhook Service: Starts checking for updates to post (if configured).
    console.log('⏳ Starting Webhook notification service (if configured)...');
    startWebhookService();

    // --- Phase 4: Start HTTP Server ---
    const PORT = process.env.PORT || 3000;

    // Global Uncaught Exception Handler: A safety net for unexpected errors.
    process.on('uncaughtException', (error) => {
      console.error('💥 UNCAUGHT EXCEPTION! Shutting down...', error);
      // Perform cleanup and exit.
      if (redisClient && redisClient.isOpen) {
        redisClient.quit();
      }
      process.exit(1);
    });

    // Start the Express server, listening on the configured port.
    const server = app.listen(PORT, () => {
      console.log(`\n🚀 Server is running on http://localhost:${PORT}`);
      console.log(`🌐 Public URL for CORS/Headers: ${process.env.SITE_URL}`);
      console.log('✅ Application startup complete.');
    });

    // Graceful Shutdown Handler: Listens for termination signals (e.g., from hosting platforms).
    process.on('SIGTERM', () => {
      console.log('\nSIGTERM signal received. Closing http server and Redis...');
      server.close(() => {
        console.log('  Http server closed.');
        if (redisClient && redisClient.isOpen) {
          redisClient.quit().then(() => console.log('  Redis connection closed.'));
        }
        process.exit(0);
      });
    });

  } catch (error) {
    // Catch errors during the startup sequence.
    console.error('💥 Server startup failed:', error);
    // Ensure Redis connection is closed if it was opened.
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
    }
    process.exit(1); // Exit with an error code.
  }
};

// --- Start the application ---
startServer();