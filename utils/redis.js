import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// --- Redis Client Creation ---
// Creates a Redis client instance using the URL from environment variables.
// Includes configuration for connection timeout and a reconnection strategy.
const redisClient = createClient({
  url: process.env.REDIS_URL, // The connection string for your Redis instance.
  socket: {
    connectTimeout: 5000, // Timeout for establishing connection (5 seconds).
    // Defines a retry strategy: wait 100ms * retries, up to a max of 5 seconds.
    reconnectStrategy: (retries) => Math.min(retries * 100, 5000)
  }
});

// --- Redis Connection Handling ---
/**
 * Establishes a connection to the Redis server if not already connected.
 * Exits the process if the connection fails.
 * @returns {Promise<RedisClientType>} The connected Redis client instance.
 */
const connectRedis = async () => {
  try {
    // Only attempt to connect if the client isn't already open.
    if (!redisClient.isOpen) {
      await redisClient.connect();
      console.log('✅ Redis connected successfully.');
    }
    return redisClient;
  } catch (error) {
    console.error('💥 Redis connection failed:', error);
    process.exit(1); // Exit the application on critical Redis connection failure.
  }
};

// --- Redis Event Listeners ---
// Logs errors encountered by the Redis client.
redisClient.on('error', (err) => console.error('  [Redis Client Error]:', err));
// Logs when the client attempts to reconnect.
redisClient.on('reconnecting', () => console.log('  [Redis] Reconnecting...'));
// Logs when the client is ready to process commands.
redisClient.on('ready', () => console.log('  [Redis] Ready.'));

// Export the client instance and the connection function.
export { redisClient, connectRedis };