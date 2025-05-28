import { redisClient } from '../../utils/redis.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// --- Configuration ---

// Define the default API URL to use if the environment variable is not set.
const DEFAULT_PRICE_API = 'https://api.coingecko.com/api/v3/simple/price';

// Get the comma-separated list of API URLs from the environment variable.
const PRICE_API_URLS = (process.env.PRICE_API_URLS || DEFAULT_PRICE_API)
    .split(',')
    .map(url => url.trim()) // Ensure no leading/trailing whitespace
    .filter(Boolean); // Remove any empty strings

// Parse crypto symbols and create a mapping (e.g., BTC -> bitcoin).
const CRYPTO_SYMBOLS = process.env.CRYPTO_SYMBOLS?.split(',') || [];
const SYMBOL_MAP = Object.fromEntries(
    CRYPTO_SYMBOLS.map(pair => {
        const [symbol, apiId] = pair.split(':');
        return [symbol, apiId];
    })
);

// Define limits and intervals from environment variables or use defaults.
const PRICE_HISTORY_LIMIT = parseInt(process.env.PRICE_HISTORY_LIMIT) || 1440;
const PRICE_API_TIMEOUT = parseInt(process.env.PRICE_API_TIMEOUT) || 8000; // 8 seconds
// --- UPDATED: Default interval changed to 150000ms (150 seconds) ---
const PRICE_POLL_INTERVAL_MS = parseInt(process.env.PRICE_POLL_INTERVAL) || 150000;

/**
 * Initializes Redis with default prices if none exist.
 */
async function initializePrices() {
    try {
        const exists = await redisClient.exists('latestPrices');
        if (!exists) {
            const initialPrices = [{ symbol: 'BTC', price: 50000 }, { symbol: 'ETH', price: 3000 }];
            await redisClient.set('latestPrices', JSON.stringify(initialPrices));
            console.log('💡 Default prices initialized in Redis.');
        }
    } catch (error) {
        console.error('💥 Price initialization failed:', error);
    }
}

/**
 * Tries fetching prices from the list of API URLs, returning the first successful result.
 * @param {string[]} urls - An array of API URLs to try.
 * @param {string} ids - Comma-separated list of API IDs.
 * @returns {Promise<Array|null>} An array of price objects or null.
 */
async function tryPriceApis(urls, ids) {
    for (const apiUrl of urls) {
        console.log(`   [Price Fetch] Trying API: ${apiUrl}`);
        try {
            const response = await axios.get(apiUrl, {
                params: {
                    ids: ids,
                    vs_currencies: 'usd',
                    precision: 2
                },
                timeout: PRICE_API_TIMEOUT
            });

            if (response.data && typeof response.data === 'object' && Object.keys(response.data).length > 0) {
                const prices = Object.entries(SYMBOL_MAP).map(([symbol, apiId]) => ({
                    symbol,
                    price: response.data[apiId]?.usd || 0,
                    timestamp: Date.now()
                }));
                console.log(`   [Price Fetch] Success from ${apiUrl}`);
                return prices;
            }
            console.warn(`   [Price Fetch] Malformed response from ${apiUrl}`);

        } catch (error) {
            console.error(`   [Price Fetch] Failed for API ${apiUrl}:`, error.message);
        }
    }
    console.error('💥 [Price Fetch] All price API attempts failed.');
    return null;
}

/**
 * Fetches the current prices using the configured API URLs.
 * @returns {Promise<Array|null>} An array of price objects or null.
 */
async function fetchCurrentPrices() {
    const apiIds = Object.values(SYMBOL_MAP).join(',');
    if (!apiIds) {
        console.warn('[Price Fetch] No CRYPTO_SYMBOLS configured.');
        return null;
    }
    return await tryPriceApis(PRICE_API_URLS, apiIds);
}

/**
 * Stores the fetched price data in Redis (latest and history).
 * @param {Array} prices - An array of price objects.
 */
async function storePriceData(prices) {
    try {
        const pipeline = redisClient.multi();
        pipeline.set('latestPrices', JSON.stringify(prices));
        for (const { symbol, price, timestamp } of prices) {
            const key = `priceHistory:${symbol}`;
            pipeline.zAdd(key, { score: timestamp, value: price.toString() });
            pipeline.zRemRangeByRank(key, 0, -PRICE_HISTORY_LIMIT - 1);
        }
        await pipeline.exec();
    } catch (error) {
        console.error('💥 Price storage failed:', error);
    }
}

/**
 * Performs one price polling cycle: fetch and store.
 */
async function pricePollingCycle() {
    console.log('🔄 Fetching new prices...');
    const prices = await fetchCurrentPrices();
    if (prices) {
        console.log('💹 New prices fetched:', prices.map(p => `${p.symbol}: $${p.price}`).join(', '));
        await storePriceData(prices);
    }
}

/**
 * Starts the periodic price polling service.
 */
export function startPricePolling() {
    initializePrices().then(() => {
        pricePollingCycle();
        setInterval(pricePollingCycle, PRICE_POLL_INTERVAL_MS);
        console.log(`⏲ Price polling active (Interval: ${PRICE_POLL_INTERVAL_MS / 1000}s)`);
    }).catch(err => {
        console.error("💥 Failed to initialize prices, polling not started.", err);
    });
}