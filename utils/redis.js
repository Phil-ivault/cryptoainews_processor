import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => Math.min(retries * 100, 5000)
  }
});

// Add explicit connection handling
const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
      console.log('✅ Redis connected');
    }
    return redisClient;
  } catch (error) {
    console.error('💥 Redis connection failed:', error);
    process.exit(1);
  }
};

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('reconnecting', () => console.log('Redis reconnecting...'));
redisClient.on('ready', () => console.log('Redis ready'));

export { redisClient, connectRedis };
