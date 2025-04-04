import dotenv from 'dotenv';
import app from './app.js';
import { getAuthorizedClient } from './src/services/telegramService.js';
import { redisClient, connectRedis } from './utils/redis.js';
import { startPricePolling } from './src/services/priceService.js';

dotenv.config();

// Startup validation
const validateEnvironment = () => {
  const requiredVars = [
    'TELEGRAM_API_ID',
    'TELEGRAM_API_HASH',
    'TELEGRAM_SESSION_STRING',
    'REDIS_URL'
  ];

  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      throw new Error(`Missing ${varName} in environment`);
    }
  });
};

const startServer = async () => {
  try {
    // Phase 1: Environment validation
    validateEnvironment();
    console.log(' Environment validation passed');

    // Phase 2: Redis initialization
    console.log(' Connecting to Redis...');
    await connectRedis(); // Ensure connection is established

    //  One-time Redis flush (remove after use)
    if (process.env.DO_FLUSH_REDIS === 'true') {
      console.log('⚠️ FLUSHING REDIS DATABASE');
      await redisClient.flushDb();
      console.log('✅ Redis flushed - REMOVE DO_FLUSH_REDIS ENV VARIABLE');
      // Process.env.DO_FLUSH_REDIS = ''; // Doesn't work - must remove via Render UI
    }

    console.log(' Checking initial prices...');
    const initialPrices = await redisClient.get('latestPrices');
    console.log(' Initial prices:', initialPrices || 'Not found');

    // Set initial prices if they don't exist
    startPricePolling();
    if (!await redisClient.get('prices')) {
      await redisClient.set('prices', JSON.stringify(initialPrices));
      console.log('💰 Default prices initialized');
    }

    // Initialize articles array if empty
    if (!await redisClient.get('articles')) {
      await redisClient.set('articles', JSON.stringify([]));
      console.log(' Empty articles cache initialized');
    }

    // Phase 3: Telegram initialization
    console.log(' Initializing Telegram client...');
    await getAuthorizedClient();
    console.log('✅ Telegram authorized');

    // Phase 4: Server startup
    const PORT = process.env.PORT || 3000;

    process.on('uncaughtException', (error) => {
      console.error(' CRASH:', error);
      process.exit(1);
    });

    const server = app.listen(PORT, () => {
      console.log(` Server running on port ${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log(' Shutting down gracefully...');
      server.close(async () => {
        await redisClient.quit();
        console.log(' Connections closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error(' Server startup failed:', error);
    process.exit(1);
  }
};

// Start the application lifecycle
startServer();
