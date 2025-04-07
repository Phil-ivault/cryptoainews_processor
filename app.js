import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { securityMiddleware } from './utils/security.js';
// No direct imports needed from telegramService or openai for API routes
import { redisClient } from './utils/redis.js';

// Configure paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'src', 'public'); // Assuming index.html is in src/public

const app = express();

// Middleware
app.use(express.json());
app.use(cors()); // Ensure CORS origin is correctly set via SITE_URL env var in security.js
app.use(securityMiddleware); // Apply security middleware array (CORS, Helmet, Rate Limiters)
app.use(express.static(publicDir)); // Serve static files from public directory

// Trust proxy headers if behind a load balancer/proxy (e.g., on Render)
app.set('trust proxy', process.env.PROXY_TRUST_LEVEL || 1);

// Routes
// Serve the main HTML file (optional, depends on your frontend setup)
app.get('/', (req, res) => {
  // Check if index.html exists? For now, assume it does.
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) {
      // Handle error if file doesn't exist or other read issues
      if (err.code === 'ENOENT') {
        res.status(404).send("Resource not found.");
      } else {
        res.status(500).send("Server error serving static file.");
      }
    }
  });
});

// API Endpoints
app.get('/api/cached-prices', async (req, res) => {
  try {
    // Ensure CRYPTO_SYMBOLS are defined and parsed correctly
    const symbols = process.env.CRYPTO_SYMBOLS?.split(',').map(p => p.split(':')[0].trim()).filter(Boolean) || [];
    if (symbols.length === 0) {
      console.warn("No CRYPTO_SYMBOLS defined in environment for /api/cached-prices");
      return res.json({}); // Return empty object if no symbols defined
    }

    const pricesJson = await redisClient.get('latestPrices');
    const prices = pricesJson ? JSON.parse(pricesJson) : [];

    // Create a map for faster lookup
    const priceMap = new Map(prices.map(p => [p.symbol, p.price]));

    // Build the response object based on requested symbols
    const priceData = symbols.reduce((acc, symbol) => {
      acc[symbol] = priceMap.get(symbol) || null; // Use map for efficient lookup
      return acc;
    }, {});

    res.json(priceData);
  } catch (error) {
    console.error('API Error fetching cached prices:', error);
    res.status(500).json({ error: 'Failed to fetch cached prices' });
  }
});

app.get('/api/cached-articles', async (req, res) => {
  try {
    const articlesJson = await redisClient.get('articles');
    const articles = articlesJson ? JSON.parse(articlesJson) : [];
    res.json(articles); // Send the array directly
  } catch (error) {
    console.error('API Error fetching cached articles:', error);
    res.status(500).json({ error: 'Failed to fetch cached articles' });
  }
});

app.get('/api/articles/:apiId', async (req, res) => {
  // API ID is expected to be a string (or number if using INCR)
  const requestedApiId = req.params.apiId; // Get param as string

  // Convert to number ONLY if your apiId is numeric (it is, from INCR)
  const apiIdAsNumber = parseInt(requestedApiId, 10);
  if (isNaN(apiIdAsNumber)) {
    return res.status(400).json({ success: false, error: 'Invalid API ID format - must be a number' });
  }


  try {
    const articlesJson = await redisClient.get('articles');
    const articles = articlesJson ? JSON.parse(articlesJson) : [];

    // Find article using the 'apiId' field and comparing numbers
    const article = articles.find(a => a.apiId === apiIdAsNumber); // Compare numbers

    if (article) {
      // Return only the found article object
      res.json({ success: true, data: article });
    } else {
      // Article with the specified apiId not found
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

// Export the configured Express app instance
// This allows server.js (or tests) to import and use it
export default app;