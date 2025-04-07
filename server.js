import dotenv from 'dotenv';
import app from './app.js';
// Import initializeSystem explicitly if needed for counter init before polling
import { getAuthorizedClient, startTelegramPolling, initializeSystem as initializeTelegramSystem } from './src/services/telegramService.js';
import { redisClient, connectRedis } from './utils/redis.js';
import { startPricePolling } from './src/services/priceService.js';
import { startWebhookService } from './src/services/webhookService.js'; // Import webhook service starter

dotenv.config();

// Startup validation
const validateEnvironment = () => {
  const requiredVars = [
    'TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION_STRING', 'TELEGRAM_CHANNEL',
    'REDIS_URL',
    'OPENROUTER_API_KEYS' // Add if essential before any AI call might happen during init
    // WEBHOOK_TARGET_URL is optional, service handles absence
  ];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) throw new Error(`Missing env vars: ${missingVars.join(', ')}`);
  console.log('✅ Core environment variables validated.');
};

const startServer = async () => {
  try {
    // Phase 1: Environment validation
    validateEnvironment();

    // Phase 2: Redis initialization
    console.log('⏳ Connecting to Redis...');
    await connectRedis();
    console.log('✅ Connected to Redis.');
    // Optional Redis flush logic remains here...
    if (process.env.DO_FLUSH_REDIS === 'true') { /* ... flush logic ... */ }


    // Phase 3: Initialize Services & Caches

    // 3a. Price Service
    console.log('⏳ Starting price polling service...');
    startPricePolling();
    // Price cache check/init logic remains here...

    // 3b. Telegram System Initialization (includes API ID counter)
    console.log('⏳ Initializing Telegram system components...');
    await initializeTelegramSystem(); // Explicitly run init for counter setup etc.
    console.log('✅ Telegram system components initialized.');
    // Initialize articles cache remains here...

    // 3c. Start Telegram Polling (background)
    console.log('⏳ Starting Telegram article polling service...');
    startTelegramPolling(); // Starts interval polling

    // 3d. Start Webhook Service (background)
    console.log('⏳ Starting Webhook notification service...');
    startWebhookService(); // Starts interval checking/posting


    // Phase 4: Start HTTP Server
    const PORT = process.env.PORT || 3000;
    process.on('uncaughtException', (error) => { /* ... error handling ... */ });
    const server = app.listen(PORT, () => { /* ... log server running ... */ });
    process.on('SIGTERM', () => { /* ... graceful shutdown ... */ });

  } catch (error) {
    console.error('💥 Server startup failed:', error);
    if (redisClient && redisClient.isOpen) { /* ... close redis ... */ }
    process.exit(1);
  }
};

// --- Start the application ---
startServer();