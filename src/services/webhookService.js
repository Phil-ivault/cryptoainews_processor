import axios from 'axios';
import crypto from 'crypto'; // Used for hashing data to detect changes.
import dotenv from 'dotenv';
import { redisClient } from '../../utils/redis.js';

dotenv.config();

// --- Configuration ---
const WEBHOOK_TARGET_URL = process.env.WEBHOOK_TARGET_URL; // URL to send updates to.
const WEBHOOK_INTERVAL_MINUTES = parseInt(process.env.WEBHOOK_INTERVAL_MINUTES) || 1; // Check interval.
const WEBHOOK_POST_TIMEOUT_MS = 15000; // Timeout for the POST request.

// Redis keys to store the state of the last successful post.
const LAST_POSTED_ARTICLE_MAX_ID_KEY = 'webhook_last_posted_article_max_id';
const LAST_POSTED_PRICES_HASH_KEY = 'webhook_last_posted_prices_hash';

// Service State Variable
let isWebhookCheckRunning = false; // Flag to prevent overlapping checks.

/**
 * Calculates an MD5 hash of the given data.
 * Used to efficiently check if price data has changed.
 * @param {*} data - The data to hash.
 * @returns {string} The MD5 hash as a hex string.
 */
function calculateHash(data) {
    if (!data) return '';
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
}

/**
 * Checks for updates in articles or prices and posts them to the webhook URL if changes are detected.
 */
async function checkAndPostUpdates() {
    // Skip if no URL is set or if a check is already running.
    if (!WEBHOOK_TARGET_URL) return;
    if (isWebhookCheckRunning) {
        console.log('[Webhook] Skip: Previous check still running.');
        return;
    }

    isWebhookCheckRunning = true;
    console.log(`\n📡 [Webhook] Checking for updates...`);

    try {
        // 1. Get current data from Redis.
        const articlesJson = await redisClient.get('articles');
        const pricesJson = await redisClient.get('latestPrices');
        const currentArticles = articlesJson ? JSON.parse(articlesJson) : [];
        const currentPrices = pricesJson ? JSON.parse(pricesJson) : [];

        // 2. Determine current state indicators.
        // We use the highest Telegram ID ('id') from the latest article (which is first in the sorted array).
        const currentArticleMaxId = currentArticles.length > 0 ? currentArticles[0].id : 0;
        const currentPricesHash = calculateHash(currentPrices);

        // 3. Get last posted state indicators.
        const lastPostedArticleMaxId = parseInt(await redisClient.get(LAST_POSTED_ARTICLE_MAX_ID_KEY) || '0');
        const lastPostedPricesHash = await redisClient.get(LAST_POSTED_PRICES_HASH_KEY) || '';

        // 4. Compare current state with the last posted state.
        const articlesChanged = currentArticleMaxId > lastPostedArticleMaxId;
        const pricesChanged = currentPricesHash !== lastPostedPricesHash;

        // 5. Post data if changes are detected.
        if (articlesChanged || pricesChanged) {
            console.log(`   [Webhook] Change detected (Articles: ${articlesChanged}, Prices: ${pricesChanged}). Posting...`);

            const payload = {
                allArticles: currentArticles,
                latestArticle: currentArticles.length > 0 ? currentArticles[0] : null,
                latestPrices: currentPrices
            };

            const startTime = Date.now();
            try {
                // Send the POST request using axios.
                const response = await axios.post(WEBHOOK_TARGET_URL, payload, {
                    timeout: WEBHOOK_POST_TIMEOUT_MS,
                    headers: {
                        'Content-Type': 'application/json',
                        // Optional: Add an auth token if needed by the target.
                        // 'Authorization': `Bearer ${process.env.WEBHOOK_AUTH_TOKEN}`
                    }
                });

                const duration = Date.now() - startTime;
                // Check for a successful HTTP status code (2xx).
                if (response.status >= 200 && response.status < 300) {
                    console.log(`✅ [Webhook] Successfully posted update (${response.status}) in ${duration}ms.`);

                    // 6. Update last posted state in Redis ONLY on success.
                    const multi = redisClient.multi();
                    multi.set(LAST_POSTED_ARTICLE_MAX_ID_KEY, currentArticleMaxId);
                    multi.set(LAST_POSTED_PRICES_HASH_KEY, currentPricesHash);
                    await multi.exec();

                } else {
                    console.error(`❌ [Webhook] Post failed with status ${response.status} in ${duration}ms.`);
                }

            } catch (postError) {
                const duration = Date.now() - startTime;
                console.error(`❌ [Webhook] Error posting update after ${duration}ms:`, postError.message);
                // Log detailed error info if available.
                if (postError.response) {
                    console.error('   [Webhook] Error Response Status:', postError.response.status);
                } else if (postError.request) {
                    console.error('   [Webhook] No response received (Timeout or Network Issue).');
                }
            }

        } else {
            console.log('   [Webhook] No changes detected since last post.');
        }

    } catch (error) {
        console.error('💥 [Webhook] Critical error during check/post cycle:', error);
    } finally {
        isWebhookCheckRunning = false; // Release the lock.
    }
}

/**
 * Starts the webhook service, setting up an interval to call checkAndPostUpdates.
 */
function startWebhookService() {
    if (!WEBHOOK_TARGET_URL) {
        console.warn('ℹ️ [Webhook] Service not starting: WEBHOOK_TARGET_URL is not defined.');
        return;
    }

    const intervalMs = WEBHOOK_INTERVAL_MINUTES * 60 * 1000;
    console.log(`⏱️ [Webhook] Service starting. Checking every ${WEBHOOK_INTERVAL_MINUTES} minute(s).`);

    // Run the check once soon after start, then set the interval.
    setTimeout(checkAndPostUpdates, 5000); // Wait 5 seconds before first check.
    setInterval(checkAndPostUpdates, intervalMs);
}

export { startWebhookService };