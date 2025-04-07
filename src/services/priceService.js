import { redisClient } from '../../utils/redis.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3/simple/price';
const CRYPTO_SYMBOLS = process.env.CRYPTO_SYMBOLS?.split(',') || [];
const SYMBOL_MAP = Object.fromEntries(
    CRYPTO_SYMBOLS.map(pair => {
        const [symbol, coingeckoId] = pair.split(':');
        return [symbol, coingeckoId];
    })
);
const PRICE_HISTORY_LIMIT = process.env.PRICE_HISTORY_LIMIT || 60;

async function initializePrices() {
    try {
        const exists = await redisClient.exists('latestPrices');
        if (!exists) {
            const initialPrices = [
                { symbol: 'BTC', price: 50000 },
                { symbol: 'ETH', price: 3000 }
            ];
            await redisClient.set('latestPrices', JSON.stringify(initialPrices));
            console.log('💡 Default prices initialized');
        }
    } catch (error) {
        console.error('Price initialization failed:', error);
    }
}

async function fetchCurrentPrices() {
    try {
        const response = await axios.get(COINGECKO_API_URL, {
            params: {
                ids: Object.values(SYMBOL_MAP).join(','),
                vs_currencies: 'usd',
                precision: 2
            },
            timeout: 8000
        });

        return Object.entries(SYMBOL_MAP).map(([symbol, coingeckoId]) => ({
            symbol,
            price: response.data[coingeckoId]?.usd || 0,
            timestamp: Date.now()
        }));
    } catch (error) {
        console.error('Price fetch failed:', error.message);
        return null;
    }
}

async function storePriceData(prices) {
    try {
        const pipeline = redisClient.multi();

        // Update latest prices
        pipeline.set('latestPrices', JSON.stringify(prices));

        // Maintain 1-hour history
        for (const { symbol, price, timestamp } of prices) {
            const key = `priceHistory:${symbol}`;
            pipeline.zAdd(key, { score: timestamp, value: price.toString() });
            pipeline.zRemRangeByRank(key, 0, -PRICE_HISTORY_LIMIT - 1);
        }

        await pipeline.exec();
    } catch (error) {
        console.error('Price storage failed:', error);
    }
}

async function pricePollingCycle() {
    console.log('🔄 Fetching new prices...');
    const prices = await fetchCurrentPrices();
    if (prices) {
        console.log('💹 New prices:', prices);
        await storePriceData(prices);
    }
}

export function startPricePolling(interval = 120000) {
    // Initialize first before starting interval
    initializePrices().then(() => {
        setInterval(pricePollingCycle, interval);
        pricePollingCycle(); // Immediate first fetch
        console.log(`⏲ Price polling active (${interval / 1000}s interval)`);
    });
}