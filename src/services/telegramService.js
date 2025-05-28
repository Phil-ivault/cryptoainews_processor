import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { processTelegramMessage } from '../../utils/openai.js';
import { redisClient } from '../../utils/redis.js';

// --- Configuration ---
dotenv.config(); // Load environment variables.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Telegram & Application Settings from Environment Variables
const TELEGRAM_CHANNEL = process.env.TELEGRAM_CHANNEL;
const MAX_ARTICLES = parseInt(process.env.MAX_ARTICLES) || 25; // Max articles to keep in cache.
const MESSAGE_FETCH_LIMIT = parseInt(process.env.MESSAGE_FETCH_LIMIT) || 25; // How many messages to fetch per cycle.
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 60000; // Interval in ms for checking new messages.
const PROCESSED_SET = 'processed_ids'; // Redis set key for tracking processed message IDs.
const LOCK_TTL = parseInt(process.env.PROCESSING_LOCK_TTL) || 60; // Lock time-to-live in seconds to prevent race conditions.
const ARTICLE_API_ID_COUNTER_KEY = 'article_api_id_counter'; // Redis key for the sequential article ID.
const ARTICLE_API_ID_START = 999; // Set to 999 so the first INCR yields 1000.

// Service State Variables
let isPollingActive = false; // Flag to prevent overlapping poll cycles.
let clientInstance = null; // Holds the active Telegram client instance.

/**
 * Validates essential Telegram environment variables.
 * @returns {Array} An array containing the API ID (number) and API Hash (string).
 * @throws {Error} If any required environment variable is missing.
 */
const validateEnvironment = () => {
  const requiredVars = [
    'TELEGRAM_API_ID',
    'TELEGRAM_API_HASH',
    'TELEGRAM_SESSION_STRING',
    'TELEGRAM_CHANNEL'
  ];
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  });
  console.log("✅ Telegram environment variables validated.");
  return [Number(process.env.TELEGRAM_API_ID), process.env.TELEGRAM_API_HASH];
};

const [apiId, apiHash] = validateEnvironment();
const session = new StringSession(process.env.TELEGRAM_SESSION_STRING || '');

/**
 * Creates, connects, and authorizes a Telegram client.
 * Reuses an existing connected client if available.
 * @returns {Promise<TelegramClient|null>} The authorized Telegram client or null on failure.
 */
async function getAuthorizedClient() {
  // Return existing client if it's connected and authorized.
  if (clientInstance?.connected && await clientInstance.checkAuthorization()) {
    return clientInstance;
  }
  console.log('⏳ Establishing Telegram connection...');
  try {
    clientInstance = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true, // Use WebSocket Secure, often more reliable.
      autoReconnect: true
    });

    await clientInstance.connect();

    if (!(await clientInstance.checkAuthorization())) {
      throw new Error('Telegram authorization failed. Check API credentials and Session String.');
    }

    console.log('✅ Telegram client authorized and connected.');
    return clientInstance;
  } catch (error) {
    console.error('💥 Fatal Error connecting to Telegram:', error);
    process.exit(1); // Exit on critical connection failure.
  }
}

/**
 * Checks if a URL object has a valid HTTP/HTTPS protocol.
 * @param {URL} url - The URL object to check.
 * @returns {boolean} True if the URL uses http or https.
 */
function isValidHttpUrl(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/**
 * Extracts the first valid HTTP/HTTPS URL from a message text or its entities.
 * Prioritizes 'MessageEntityTextUrl' for better accuracy.
 * @param {string} text - The message text.
 * @param {Array} [entities=[]] - Array of message entities (links, formatting).
 * @returns {string|null} The first valid URL found, or null.
 */
function extractValidUrl(text, entities = []) {
  try {
    // 1. Check Telegram Entities first (more reliable).
    const urlEntity = entities.find(e => e.className === 'MessageEntityTextUrl' || e.type === 'textUrl');
    if (urlEntity?.url) {
      try {
        const parsed = new URL(urlEntity.url);
        if (isValidHttpUrl(parsed)) {
          // console.log(`   https://dictionary.cambridge.org/dictionary/english/extract Found URL in entity: ${parsed.toString()}`); // Removed noisy log
          return parsed.toString();
        }
      } catch (_) { /* Ignore invalid URLs in entities */ }
    }

    // 2. Regex Fallback if no valid entity URL found.
    const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
    const matches = text.match(urlRegex) || [];
    for (const url of matches) {
      try {
        const parsed = new URL(url);
        if (isValidHttpUrl(parsed)) {
          // console.log(`   https://dictionary.cambridge.org/dictionary/english/extract Found URL via regex: ${parsed.toString()}`); // Removed noisy log
          return parsed.toString(); // Return the first valid URL.
        }
      } catch (_) { /* Ignore invalid URLs from regex */ }
    }

    // 3. No valid URL found.
    return null;
  } catch (error) {
    console.error("   https://dictionary.cambridge.org/dictionary/english/extract Error during URL extraction:", error);
    return null;
  }
}


/**
 * Processes a single Telegram message: extracts content, calls AI, stores article.
 * Includes locking and duplicate checks.
 * @param {object} message - The Telegram message object.
 * @returns {Promise<boolean>} True if processed or skipped successfully, false on failure.
 */
async function processAndStoreMessage(message) {
  if (!message || !message.id) {
    console.warn("   [Process Store] Invalid message object received.");
    return false;
  }
  const msgId = message.id;
  const lockKey = `lock:${msgId}`;

  try {
    // 1. Lock message ID to prevent concurrent processing and check if already processed.
    const lockAcquired = await redisClient.set(lockKey, 'processing', { NX: true, EX: LOCK_TTL });
    if (!lockAcquired) return true; // Already being processed, count as skipped.

    const isProcessed = await redisClient.sIsMember(PROCESSED_SET, msgId.toString());
    if (isProcessed) {
      await redisClient.del(lockKey);
      return true; // Already processed, count as skipped.
    }

    // 2. Extract URL and check if message is suitable for processing.
    const rawText = message.text?.substring(0, 2000) || ''; // Limit text size.
    const entities = message.entities || [];
    const extractedUrl = extractValidUrl(rawText, entities);

    if (!extractedUrl) {
      console.log(`   [Process Store] Skipping ${msgId} - No valid URL found.`);
      await redisClient.sAdd(PROCESSED_SET, msgId.toString());
      await redisClient.del(lockKey);
      return true; // Skipped (no URL).
    }

    // 3. Call AI to process content.
    console.log(`   [Process Store] Processing content for ${msgId}...`);
    const processed = await processTelegramMessage(rawText, msgId, extractedUrl);

    // 4. Validate AI output.
    if (!processed || !processed.headline || !processed.content || processed.content.length < 50) {
      const reason = !processed ? 'AI returned null' : (!processed.headline ? 'missing headline' : 'content too short');
      console.warn(`   [Process Store] Invalid article format for ${msgId} (${reason}). Skipping.`);
      await redisClient.set(`failed:${msgId}`, `Processing failed: ${reason}`, { EX: 3600 * 24 }); // Log failure temporarily.
      await redisClient.sAdd(PROCESSED_SET, msgId.toString()); // Mark as processed (even if failed).
      await redisClient.del(lockKey);
      return false; // Failure.
    }

    // 5. Prepare and store the new article.
    const cleanHeadline = processed.headline.replace(/[*_~`"']/g, '').trim().substring(0, 100);
    const nextApiId = await redisClient.incr(ARTICLE_API_ID_COUNTER_KEY); // Get unique sequential ID.

    const newArticle = {
      id: msgId,
      apiId: nextApiId,
      headline: cleanHeadline,
      article: processed.content,
      source: extractedUrl,
      date: new Date().toISOString(),
      status: 'processed'
    };

    // 6. Update articles list in Redis atomically.
    const currentArticlesStr = await redisClient.get('articles') || '[]';
    const currentArticles = JSON.parse(currentArticlesStr);

    const updatedArticles = [newArticle, ...currentArticles.filter(a => a.id !== msgId)]
      .sort((a, b) => b.id - a.id) // Sort by Telegram ID (newest first).
      .slice(0, MAX_ARTICLES); // Keep only the latest N articles.

    const multi = redisClient.multi();
    multi.set('articles', JSON.stringify(updatedArticles));
    multi.sAdd(PROCESSED_SET, msgId.toString());
    multi.del(`failed:${msgId}`); // Remove failure log on success.
    await multi.exec();

    console.log(`✅ [Process Store] Stored article (MsgID ${msgId}, API_ID ${nextApiId})`);
    return true; // Success.

  } catch (error) {
    console.error(`❌ [Process Store] Critical error processing ${msgId}:`, error);
    if (msgId) {
      await redisClient.set(`failed:${msgId}`, `Critical error: ${error.message}`, { EX: 3600 * 24 });
      await redisClient.sAdd(PROCESSED_SET, msgId.toString());
    }
    return false; // Failure.
  } finally {
    if (msgId) await redisClient.del(lockKey); // Always release the lock.
  }
}

/**
 * Gets the ID of the most recent message in the Telegram channel.
 * @param {TelegramClient} client - The authorized Telegram client.
 * @returns {Promise<number>} The ID of the latest message, or 0.
 */
async function getCurrentTelegramMaxId(client) {
  if (!client) return 0;
  try {
    const [latestMessage] = await client.getMessages(TELEGRAM_CHANNEL, { limit: 1, reverse: false });
    return latestMessage?.id || 0;
  } catch (error) {
    console.error("   [Get Max ID] Error fetching latest message ID:", error);
    return 0;
  }
}

/**
 * Fetches older messages from Telegram for backfilling the cache.
 * @param {TelegramClient} client - The authorized Telegram client.
 * @param {number} oldestStoredId - The ID of the oldest message currently stored.
 * @param {number} neededCount - How many messages are needed.
 * @returns {Promise<Array>} An array of older message objects.
 */
async function fetchMessagesForBackfill(client, oldestStoredId, neededCount) {
  console.log(`[Backfill Fetch] Looking for ${neededCount} messages older than ID ${oldestStoredId}`);
  if (!client || oldestStoredId <= 1) return []; // Cannot fetch older than 1.

  try {
    const fetchLimit = Math.max(neededCount + 10, MESSAGE_FETCH_LIMIT);
    const messages = await client.getMessages(TELEGRAM_CHANNEL, {
      limit: fetchLimit,
      offsetId: oldestStoredId, // Start from the oldest ID we have.
      addOffset: 0,
      reverse: true // Fetch older messages (IDs less than offsetId).
    });
    const validMessages = messages.filter(msg => msg?.id && msg.id < oldestStoredId);
    console.log(`[Backfill Fetch] Found ${validMessages.length} raw older messages.`);
    return validMessages;
  } catch (error) {
    console.error(`📩 [Backfill Fetch] Fetch Failed (around ID ${oldestStoredId}):`, error);
    return [];
  }
}

/**
 * Fetches the latest messages from Telegram, newer than a given ID.
 * Also attempts to refetch messages marked as 'failed'.
 * @param {TelegramClient} client - The authorized Telegram client.
 * @param {number} redisMaxId - The ID of the newest message previously processed.
 * @returns {Promise<Array>} An array of new message objects.
 */
async function fetchLatestMessages(client, redisMaxId) {
  console.log(`[New Fetch] Fetching messages newer than ID ${redisMaxId}`);
  if (!client) return [];

  try {
    // Fetch latest messages.
    const messages = await client.getMessages(TELEGRAM_CHANNEL, {
      limit: MESSAGE_FETCH_LIMIT,
      offsetId: 0,
      addOffset: 0,
      reverse: false // Fetch newer messages.
    });
    const unprocessedNewer = messages.filter(msg => msg?.id && msg.id > redisMaxId);

    // Attempt to retry failed messages.
    const failedKeys = await redisClient.keys('failed:*');
    const failedIdsToRetry = failedKeys
      .map(k => parseInt(k.split(':')[1]))
      .filter(id => !isNaN(id) && id > redisMaxId);

    let failedMessages = [];
    if (failedIdsToRetry.length > 0) {
      console.log(`   [New Fetch] Retrying ${failedIdsToRetry.length} failed IDs > ${redisMaxId}`);
      try {
        const fetchedFailed = await client.getMessages(TELEGRAM_CHANNEL, { ids: failedIdsToRetry });
        failedMessages = fetchedFailed.filter(msg => msg?.id && msg.id > redisMaxId);
      } catch (fetchError) {
        console.error(`      [New Fetch] Error refetching failed messages:`, fetchError);
      }
    }

    // Combine and deduplicate.
    const combined = [...unprocessedNewer, ...failedMessages];
    const uniqueMessages = Array.from(new Map(combined.map(msg => [msg.id, msg])).values());
    console.log(`[New Fetch] Found ${uniqueMessages.length} unique potential new messages.`);
    return uniqueMessages;

  } catch (error) {
    console.error(`📩 [New Fetch] Fetch Failed (after ID ${redisMaxId}):`, error);
    return [];
  }
}

/**
 * Executes one polling cycle: backfills if needed, fetches new messages, processes them.
 */
async function executePoll() {
  if (isPollingActive) {
    console.log('[POLL] Skip: Previous poll still running.');
    return;
  }
  isPollingActive = true;
  console.log(`\n🔄 [POLL] Cycle starting at ${new Date().toISOString()}`);
  let client = null;

  try {
    client = await getAuthorizedClient();
    if (!client) throw new Error("Telegram client not available.");

    const currentArticles = JSON.parse(await redisClient.get('articles') || '[]');
    const currentArticleCount = currentArticles.length;
    const redisMaxId = parseInt(await redisClient.get('lastMaxId') || '0');
    console.log(`[POLL] State: ${currentArticleCount} articles. Last Max ID: ${redisMaxId}`);

    // --- Backfill Logic ---
    if (currentArticleCount < MAX_ARTICLES) {
      const oldestId = currentArticles.length > 0 ? Math.min(...currentArticles.map(a => a.id)) : (redisMaxId > 0 ? redisMaxId + 1 : 1);
      if (oldestId > 1) {
        const needed = MAX_ARTICLES - currentArticleCount;
        const messagesToBackfill = await fetchMessagesForBackfill(client, oldestId, needed);
        if (messagesToBackfill.length > 0) {
          console.log(`   [Backfill] Processing ${messagesToBackfill.length} older messages...`);
          for (const message of messagesToBackfill.sort((a, b) => a.id - b.id)) { // Process oldest first
            if (!message || !message.id || await redisClient.sIsMember(PROCESSED_SET, message.id.toString())) continue;
            await processAndStoreMessage(message);
            if (JSON.parse(await redisClient.get('articles') || '[]').length >= MAX_ARTICLES) break; // Stop if full
          }
        } else {
          console.log('   [Backfill] No older messages found.');
        }
      }
    }

    // --- Fetch Newer Messages Logic ---
    const newMessages = await fetchLatestMessages(client, redisMaxId);
    let highestProcessedIdThisCycle = redisMaxId;
    if (newMessages.length > 0) {
      console.log(`   [New Messages] Processing ${newMessages.length} newer messages...`);
      for (const message of newMessages.sort((a, b) => b.id - a.id)) { // Process newest first
        if (!message || !message.id || message.id <= redisMaxId || await redisClient.sIsMember(PROCESSED_SET, message.id.toString())) continue;
        const success = await processAndStoreMessage(message);
        if (success) highestProcessedIdThisCycle = Math.max(highestProcessedIdThisCycle, message.id);
      }
    } else {
      console.log('   [New Messages] No new messages found.');
    }

    // --- Update lastMaxId ---
    const finalTelegramMaxId = await getCurrentTelegramMaxId(client);
    const newLastMaxId = Math.max(highestProcessedIdThisCycle, finalTelegramMaxId, redisMaxId);
    if (newLastMaxId > redisMaxId) {
      await redisClient.set('lastMaxId', newLastMaxId);
      console.log(`📈 [POLL] Updated lastMaxId to ${newLastMaxId}`);
    }

  } catch (error) {
    console.error('💥 [POLL] Critical error during poll cycle:', error);
  } finally {
    isPollingActive = false;
    console.log(`🏁 [POLL] Cycle completed.`);
  }
}

/**
 * Initializes the system: sets up API ID counter and performs an initial fetch.
 * @returns {Promise<void>}
 * @throws {Error} If initialization fails.
 */
async function initializeSystem() {
  console.log('🚀 [Init] Starting system setup...');
  try {
    const client = await getAuthorizedClient();
    if (!client) throw new Error("Client initialization failed.");

    // Initialize API ID Counter if it doesn't exist.
    const counterExists = await redisClient.exists(ARTICLE_API_ID_COUNTER_KEY);
    if (!counterExists) {
      await redisClient.set(ARTICLE_API_ID_COUNTER_KEY, ARTICLE_API_ID_START);
      console.log(`   [Init] Initialized Article API ID counter to ${ARTICLE_API_ID_START}.`);
    }

    // Perform an initial fetch/poll to populate some data quickly.
    // We can call executePoll here, or a simplified initial fetch.
    // Calling executePoll ensures both backfill and new-fetch logic runs once.
    console.log(`   [Init] Performing initial poll cycle...`);
    await executePoll(); // Run a full cycle to start.

    console.log(`✅ [Init] Initialization complete.`);

  } catch (error) {
    console.error('💥 [Init] Critical error during system initialization:', error);
    throw error; // Rethrow to prevent polling if init fails.
  }
}

/**
 * Starts the main Telegram polling loop after initialization.
 */
async function startTelegramPolling() {
  try {
    await initializeSystem(); // Ensure initialization completes first.
    console.log(`\n⏱️ [Polling] Starting polling cycle every ${POLL_INTERVAL / 1000} seconds...`);
    setInterval(executePoll, POLL_INTERVAL); // Start scheduled polling.
  } catch (error) {
    console.error('💥 Polling could not be started due to initialization failure.');
    process.exit(1);
  }
}

// Export functions for use in server.js or elsewhere.
export { getAuthorizedClient, processAndStoreMessage, executePoll, startTelegramPolling, initializeSystem };