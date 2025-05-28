import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { securityMiddleware } from './utils/security.js';
import { redisClient } from './utils/redis.js';

// --- Path Configuration ---
// Setup __filename and __dirname for ES modules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Define the path to the public directory for serving static files (frontend).
const publicDir = path.join(__dirname, 'src', 'public');

// --- Express App Initialization ---
const app = express();

// --- Core Middleware ---
// Parse incoming JSON requests.
app.use(express.json());
// Apply the security middleware array (CORS, Helmet, Rate Limiters).
// CORS origin is configured within security.js based on SITE_URL.
app.use(securityMiddleware);
// Serve static files (HTML, CSS, JS) from the public directory.
app.use(express.static(publicDir));

// --- Proxy Configuration ---
// Trust proxy headers if running behind a load balancer or proxy (e.g., on Render).
// The level (1) indicates trusting the first hop. Configurable via PROXY_TRUST_LEVEL.
app.set('trust proxy', parseInt(process.env.PROXY_TRUST_LEVEL) || 1);

// --- Routes ---

/**
 * Root Route (GET /)
 * Serves the main index.html file for the frontend.
 * Includes basic error handling for file not found or read issues.
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) {
      console.error("Error serving index.html:", err);
      if (err.code === 'ENOENT') {
        res.status(404).send("Frontend resource not found.");
      } else {
        res.status(500).send("Server error serving static file.");
      }
    }
  });
});

// --- API Endpoints ---

/**
 * GET /api/cached-prices
 * Retrieves the latest cached cryptocurrency prices from Redis.
 * It fetches prices for symbols defined in the CRYPTO_SYMBOLS env var.
 * Returns a JSON object mapping symbols to prices (or null if unavailable).
 */
app.get('/api/cached-prices', async (req, res) => {
  try {
    // Parse symbols from environment, taking only the symbol part (e.g., BTC from BTC:bitcoin).
    const symbols = process.env.CRYPTO_SYMBOLS?.split(',').map(p => p.split(':')[0].trim()).filter(Boolean) || [];
    if (symbols.length === 0) {
      console.warn("API: No CRYPTO_SYMBOLS defined for /api/cached-prices");
      return res.json({}); // Return empty if no symbols.
    }

    // Get latest prices from Redis.
    const pricesJson = await redisClient.get('latestPrices');
    const prices = pricesJson ? JSON.parse(pricesJson) : [];

    // Create a Map for efficient price lookup.
    const priceMap = new Map(prices.map(p => [p.symbol, p.price]));

    // Build the response object with prices for requested symbols.
    const priceData = symbols.reduce((acc, symbol) => {
      acc[symbol] = priceMap.get(symbol) || null;
      return acc;
    }, {});

    res.json(priceData);
  } catch (error) {
    console.error('API Error fetching cached prices:', error);
    res.status(500).json({ error: 'Failed to fetch cached prices' });
  }
});

/**
 * GET /api/cached-articles
 * Retrieves all currently cached articles from Redis.
 * Returns a JSON array of article objects.
 */
app.get('/api/cached-articles', async (req, res) => {
  try {
    const articlesJson = await redisClient.get('articles');
    const articles = articlesJson ? JSON.parse(articlesJson) : [];
    res.json(articles);
  } catch (error) {
    console.error('API Error fetching cached articles:', error);
    res.status(500).json({ error: 'Failed to fetch cached articles' });
  }
});

/**
 * GET /api/articles/:apiId
 * Retrieves a single article by its unique, sequential API ID (number).
 * This ID is generated during processing and is stable.
 * Returns a JSON object with success status and article data, or an error.
 */
app.get('/api/articles/:apiId', async (req, res) => {
  const requestedApiId = req.params.apiId;
  // Ensure the provided ID is a valid number.
  const apiIdAsNumber = parseInt(requestedApiId, 10);
  if (isNaN(apiIdAsNumber)) {
    return res.status(400).json({ success: false, error: 'Invalid API ID format - must be a number' });
  }

  try {
    const articlesJson = await redisClient.get('articles');
    const articles = articlesJson ? JSON.parse(articlesJson) : [];

    // Find the article with the matching 'apiId'.
    const article = articles.find(a => a.apiId === apiIdAsNumber);

    if (article) {
      res.json({ success: true, data: article });
    } else {
      res.status(404).json({ success: false, error: 'Article not found for the given API ID' });
    }
  } catch (error) {
    console.error(`API Error fetching article by API ID ${requestedApiId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching article details by API ID'
    });
  }
});

// --- Export App ---
// Export the configured Express app instance for use by server.js.
export default app;