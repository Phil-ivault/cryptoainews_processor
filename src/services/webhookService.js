// src/services/webhookService.js

import axios from 'axios';
import crypto from 'crypto'; // For hashing prices
import dotenv from 'dotenv';
import { redisClient } from '../../utils/redis.js'; // Adjust path if needed

dotenv.config();

const WEBHOOK_TARGET_URL = process.env.WEBHOOK_TARGET_URL;
const WEBHOOK_INTERVAL_MINUTES = parseInt(process.env.WEBHOOK_INTERVAL_MINUTES) || 1;
const WEBHOOK_POST_TIMEOUT_MS = 15000; // 15 second timeout for webhook post

// Redis keys to track last posted state
const LAST_POSTED_ARTICLE_MAX_ID_KEY = 'webhook_last_posted_article_max_id';
const LAST_POSTED_PRICES_HASH_KEY = 'webhook_last_posted_prices_hash';

let isWebhookCheckRunning = false;

function calculateHash(data) {
    if (!data) return '';
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
}

async function checkAndPostUpdates() {
    if (isWebhookCheckRunning) {
        console.log('[Webhook] Previous check still running, skipping.');
        return;
    }
    if (!WEBHOOK_TARGET_URL) {
        // console.log('[Webhook] WEBHOOK_TARGET_URL not set, skipping check.'); // Can be noisy
        return;
    }

    isWebhookCheckRunning = true;
    console.log(`\n📡 [Webhook] Checking for updates to post to ${WEBHOOK_TARGET_URL}...`);

    try {
        // 1. Get current data from Redis
        const articlesJson = await redisClient.get('articles');
        const pricesJson = await redisClient.get('latestPrices');

        const currentArticles = articlesJson ? JSON.parse(articlesJson) : [];
        const currentPrices = pricesJson ? JSON.parse(pricesJson) : [];

        // 2. Determine current state indicators
        // Use the highest Telegram ID ('id') of the latest article as the indicator for articles change
        const currentArticleMaxId = currentArticles.length > 0 ? currentArticles[0].id : 0;
        const currentPricesHash = calculateHash(currentPrices);

        // 3. Get last posted state indicators from Redis
        const lastPostedArticleMaxId = parseInt(await redisClient.get(LAST_POSTED_ARTICLE_MAX_ID_KEY) || '0');
        const lastPostedPricesHash = await redisClient.get(LAST_POSTED_PRICES_HASH_KEY) || '';

        // 4. Compare states
        const articlesChanged = currentArticleMaxId > lastPostedArticleMaxId;
        const pricesChanged = currentPricesHash !== lastPostedPricesHash;

        console.log(`   [Webhook] State Check: Articles Changed: ${articlesChanged} (Current MaxID: ${currentArticleMaxId}, Last Posted: ${lastPostedArticleMaxId})`);
        console.log(`   [Webhook] State Check: Prices Changed: ${pricesChanged} (Current Hash: ${currentPricesHash.substring(0, 8)}, Last Posted: ${lastPostedPricesHash.substring(0, 8)})`);


        if (articlesChanged || pricesChanged) {
            console.log(`   [Webhook] Change detected. Preparing payload...`);

            // Prepare payload
            const latestArticle = currentArticles.length > 0 ? currentArticles[0] : null;
            const payload = {
                allArticles: currentArticles, // Contains incremental apiId
                latestArticle: latestArticle, // Contains incremental apiId
                latestPrices: currentPrices
            };

            // 5. Post to webhook URL
            console.log(`   [Webhook] Posting payload to ${WEBHOOK_TARGET_URL}...`);
            const startTime = Date.now();
            try {
                const response = await axios.post(WEBHOOK_TARGET_URL, payload, {
                    timeout: WEBHOOK_POST_TIMEOUT_MS,
                    headers: {
                        'Content-Type': 'application/json',
                        // Add any other required headers, e.g., an auth token
                        // 'Authorization': `Bearer ${process.env.WEBHOOK_AUTH_TOKEN}`
                    }
                });

                const duration = Date.now() - startTime;
                // Check for successful HTTP status code (2xx)
                if (response.status >= 200 && response.status < 300) {
                    console.log(`✅ [Webhook] Successfully posted update (${response.status}) in ${duration}ms.`);

                    // 6. Update last posted state indicators in Redis only on success
                    const multi = redisClient.multi();
                    multi.set(LAST_POSTED_ARTICLE_MAX_ID_KEY, currentArticleMaxId);
                    multi.set(LAST_POSTED_PRICES_HASH_KEY, currentPricesHash);
                    await multi.exec();
                    console.log(`   [Webhook] Updated last posted state indicators in Redis.`);

                } else {
                    console.error(`❌ [Webhook] Post failed with status ${response.status} in ${duration}ms. Response:`, response.data);
                    // Decide if state indicators should be updated even on failure (e.g., to avoid retry loops for bad data)
                }

            } catch (postError) {
                const duration = Date.now() - startTime;
                console.error(`❌ [Webhook] Error posting update after ${duration}ms:`, postError.message);
                if (postError.response) {
                    // The request was made and the server responded with a status code outside 2xx
                    console.error('   [Webhook] Error Response Status:', postError.response.status);
                    console.error('   [Webhook] Error Response Data:', postError.response.data);
                } else if (postError.request) {
                    // The request was made but no response was received (e.g., timeout)
                    console.error('   [Webhook] No response received for webhook post.');
                } else {
                    // Something happened in setting up the request that triggered an Error
                    console.error('   [Webhook] Error setting up webhook request:', postError.message);
                }
                // Do not update last posted state on error to allow retry on next interval
            }

        } else {
            console.log('   [Webhook] No changes detected since last successful post.');
        }

    } catch (error) {
        console.error('💥 [Webhook] Critical error during check/post cycle:', error);
    } finally {
        isWebhookCheckRunning = false;
        // console.log('[Webhook] Check cycle finished.'); // Can be noisy
    }
}

function startWebhookService() {
    if (!WEBHOOK_TARGET_URL) {
        console.warn('ℹ️ [Webhook] Service not starting: WEBHOOK_TARGET_URL is not defined in environment variables.');
        return;
    }

    const intervalMs = WEBHOOK_INTERVAL_MINUTES * 60 * 1000;
    console.log(`⏱️ [Webhook] Service starting. Checking for updates every ${WEBHOOK_INTERVAL_MINUTES} minute(s) (${intervalMs}ms).`);

    // Run immediately first time? Optional.
    // setTimeout(checkAndPostUpdates, 5000); // Run after 5s delay

    // Start interval
    setInterval(checkAndPostUpdates, intervalMs);
}

export { startWebhookService };