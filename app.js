import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { securityMiddleware } from './utils/security.js';
import { fetchLatestMessages, processAndStoreMessage } from './src/services/telegramService.js';
import { redisClient } from './utils/redis.js';
import { processTelegramMessage } from './utils/openai.js';

// Configure paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'src', 'public');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(securityMiddleware);
app.use(express.static(publicDir));

app.set('trust proxy', process.env.PROXY_TRUST_LEVEL || 1);

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// API Endpoints
app.get('/api/cached-prices', async (req, res) => {
  try {
    const symbols = process.env.CRYPTO_SYMBOLS?.split(',').map(p => p.split(':')[0]) || [];
    const prices = JSON.parse(await redisClient.get('latestPrices') || '[]');

    const priceData = symbols.reduce((acc, symbol) => {
      const coinPrice = prices.find(p => p.symbol === symbol);
      acc[symbol] = coinPrice?.price || null;
      return acc;
    }, {});

    res.json(priceData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

app.get('/api/cached-articles', async (req, res) => {
  try {
    const articles = await redisClient.get('articles');
    const parsed = articles ? JSON.parse(articles) : [];
    console.log(`📦 Redis articles: ${parsed.length} items`);
    parsed.forEach(a => console.log(`- ${a.id}: ${a.headline} (${a.article?.length || 0} chars)`));
    res.json(parsed);
  } catch (error) {
    console.error('Article fetch error:', error); // Add logging
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

export default app;