import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { processTelegramMessage } from '../../utils/openai.js'; // Adjust path if needed
import { redisClient } from '../../utils/redis.js'; // Adjust path if needed
// Removed crypto import as randomUUID is no longer needed here

// --- Exports (Kept at top) ---
export { getAuthorizedClient, processAndStoreMessage, executePoll, startTelegramPolling, initializeSystem }; // Added initializeSystem export if needed by server.js

// --- Configuration ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const TELEGRAM_CHANNEL = process.env.TELEGRAM_CHANNEL;
const MAX_ARTICLES = parseInt(process.env.MAX_ARTICLES) || 25;
const MESSAGE_FETCH_LIMIT = parseInt(process.env.MESSAGE_FETCH_LIMIT) || 25;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 60000;
const PROCESSED_SET = 'processed_ids';
const LOCK_TTL = parseInt(process.env.PROCESSING_LOCK_TTL) || 60;
const ARTICLE_API_ID_COUNTER_KEY = 'article_api_id_counter'; // Redis key for counter
const ARTICLE_API_ID_START = 999; // Start counter here so first INCR gives 1000
let isPollingActive = false;
let clientInstance = null;

// --- Environment Validation ---
const validateEnvironment = () => {
  const requiredVars = [
    'TELEGRAM_API_ID',
    'TELEGRAM_API_HASH',
    'TELEGRAM_SESSION_STRING',
    'TELEGRAM_CHANNEL' // Added Channel check
  ];
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  });
  console.log("✅ Environment variables validated.");
  return [Number(process.env.TELEGRAM_API_ID), process.env.TELEGRAM_API_HASH];
};

const [apiId, apiHash] = validateEnvironment();
const session = new StringSession(process.env.TELEGRAM_SESSION_STRING || ''); // Ensure default empty string

// --- Telegram Client Initialization ---
async function getAuthorizedClient() {
  if (clientInstance?.connected && await clientInstance.checkAuthorization()) {
    return clientInstance;
  }
  console.log(' T Establishing Telegram connection...');
  try {
    clientInstance = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true, // Use WebSocket Secure (often more reliable)
      autoReconnect: true
    });

    console.log('⌛ Connecting to Telegram...');
    await clientInstance.connect();

    if (!(await clientInstance.checkAuthorization())) {
      throw new Error('Telegram authorization failed. Check API credentials and Session String.');
    }

    console.log('✅ Telegram client authorized and connected.');
    return clientInstance;
  } catch (error) {
    console.error('💥 Fatal Error connecting to Telegram:', error);
    // Optionally implement a retry mechanism here instead of exiting
    process.exit(1); // Exit if connection fails critically
  }
}

// --- URL Validation ---
function isValidHttpUrl(url) {
  // Checks for http or https protocol
  return url.protocol === 'http:' || url.protocol === 'https:';
}

// --- URL Extraction ---
function extractValidUrl(text, entities = []) {
  try {
    // 1. Check Telegram Entities (often more reliable)
    const urlEntity = entities.find(e =>
      e.className === 'MessageEntityTextUrl' || e.type === 'textUrl' // Handle different entity types
    );
    if (urlEntity?.url) {
      try {
        const parsed = new URL(urlEntity.url);
        if (isValidHttpUrl(parsed)) {
          console.log(`   https://www.merriam-webster.com/dictionary/extract Found URL in entity: ${parsed.toString()}`);
          return parsed.toString();
        }
      } catch (_) { /* Ignore invalid URLs in entities */ }
    }

    // 2. Regex Fallback (if no valid entity URL found)
    // Improved Regex: More robust, handles various edge cases
    const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
    const matches = text.match(urlRegex) || [];
    for (const url of matches) {
      try {
        const parsed = new URL(url);
        if (isValidHttpUrl(parsed)) {
          console.log(`   https://www.merriam-webster.com/dictionary/extract Found URL via regex: ${parsed.toString()}`);
          return parsed.toString(); // Return the first valid URL found
        }
      } catch (_) { /* Ignore invalid URLs from regex */ }
    }

    // 3. No valid URL found
    return null;
  } catch (error) {
    // Catch potential errors during URL parsing itself
    console.error("   https://www.merriam-webster.com/dictionary/extract Error during URL extraction:", error);
    return null;
  }
}

// --- Core Message Processing and Storage ---
async function processAndStoreMessage(message) {
  if (!message || !message.id) {
    console.warn("   [Process Store] Invalid message object received.");
    return false;
  }
  const msgId = message.id;
  const lockKey = `lock:${msgId}`;

  try {
    // 1. Lock & Check Processed Status (No changes needed here)
    const lockAcquired = await redisClient.set(lockKey, 'processing', { NX: true, EX: LOCK_TTL });
    if (!lockAcquired) {
      // console.log(`   [Process Store] Skipping ${msgId} - already being processed.`);
      return true; // Skipped, not failed
    }
    const isProcessed = await redisClient.sIsMember(PROCESSED_SET, msgId.toString());
    if (isProcessed) {
      // console.log(`   [Process Store] Skipping ${msgId} - already in PROCESSED_SET.`);
      await redisClient.del(lockKey);
      return true; // Skipped, not failed
    }
    // Redundant check (can be removed if PROCESSED_SET is reliable)
    // const currentArticlesCheck = JSON.parse(await redisClient.get('articles') || '[]') ;
    // if (currentArticlesCheck.some(a => a.id === msgId)) { ... }

    // 2. Extract URL & Process Content (No changes needed here)
    const rawText = message.text?.substring(0, 2000) || '';
    const entities = message.entities || [];
    const extractedUrl = extractValidUrl(rawText, entities);

    if (!extractedUrl) {
      console.log(`   [Process Store] Skipping ${msgId} - No valid URL found.`);
      await redisClient.sAdd(PROCESSED_SET, msgId.toString());
      await redisClient.del(lockKey);
      return true; // Skipped successfully
    }

    console.log(`   [Process Store] Processing content for ${msgId} (URL: ${extractedUrl})`);
    const processed = await processTelegramMessage(rawText, msgId, extractedUrl);

    // 3. Validate processing output (No changes needed here)
    if (!processed || !processed.headline || !processed.content || processed.content.length < 50) {
      const reason = !processed ? 'null response' : (!processed.headline ? 'missing headline' : 'content too short');
      console.warn(`   [Process Store] Invalid article format for ${msgId} (${reason}). Skipping.`);
      await redisClient.set(`failed:${msgId}`, `Processing failed: ${reason}`, { EX: 3600 * 24 });
      await redisClient.sAdd(PROCESSED_SET, msgId.toString());
      await redisClient.del(lockKey);
      return false; // Failure
    }

    // 4. Prepare article data for storage
    const cleanHeadline = processed.headline.replace(/[*_~`"']/g, '').trim().substring(0, 100);

    // --- GET INCREMENTAL API ID ---
    const nextApiId = await redisClient.incr(ARTICLE_API_ID_COUNTER_KEY);
    // -----------------------------

    const newArticle = {
      id: msgId, // Keep Telegram message ID
      apiId: nextApiId, // Use incremental ID
      headline: cleanHeadline,
      article: processed.content,
      source: extractedUrl,
      date: new Date().toISOString(),
      status: 'processed'
    };

    // 5. Update articles in Redis atomically
    const currentArticlesStr = await redisClient.get('articles') || '[]';
    const currentArticles = JSON.parse(currentArticlesStr);

    const updatedArticles = [newArticle, ...currentArticles.filter(a => a.id !== msgId)]
      .sort((a, b) => b.id - a.id)
      .slice(0, MAX_ARTICLES);

    const multi = redisClient.multi();
    multi.set('articles', JSON.stringify(updatedArticles));
    multi.sAdd(PROCESSED_SET, msgId.toString());
    multi.del(`failed:${msgId}`);
    // --- Store hash for webhook check ---
    // Calculate hash here if using hash method for webhook
    // const articlesHash = crypto.createHash('md5').update(JSON.stringify(updatedArticles)).digest('hex');
    // multi.set('current_articles_hash', articlesHash); // Or use lastMaxId instead
    // We will use lastMaxId comparison in webhook service for simplicity now
    // ---------------------------------
    await multi.exec();

    console.log(`✅ [Process Store] Stored article (MsgID ${msgId}, API_ID ${nextApiId})`);
    return true; // Success

  } catch (error) {
    console.error(`❌ [Process Store] Critical error processing ${msgId}:`, error);
    if (msgId) {
      await redisClient.set(`failed:${msgId}`, `Critical error: ${error.message}`, { EX: 3600 * 24 });
      await redisClient.sAdd(PROCESSED_SET, msgId.toString());
    }
    return false; // Failure
  } finally {
    if (msgId) await redisClient.del(lockKey);
  }
}

// --- Helper Function to Get Current Max ID from Telegram ---
async function getCurrentTelegramMaxId(client) {
  if (!client) {
    console.error("[Get Max ID] Telegram client is not available.");
    return 0; // Return 0 if client is not ready
  }
  try {
    const [latestMessage] = await client.getMessages(TELEGRAM_CHANNEL, {
      limit: 1,
      reverse: false // Get the latest message (highest ID)
    });
    const maxId = latestMessage?.id || 0;
    // console.log(`   [Get Max ID] Current Telegram Max ID: ${maxId}`); // Verbose log
    return maxId;
  } catch (error) {
    console.error("   [Get Max ID] Error fetching latest message ID from Telegram:", error);
    return 0; // Return 0 on error to avoid breaking polling logic
  }
}


// --- Fetch Messages for Backfill ---
async function fetchMessagesForBackfill(client, oldestStoredId, neededCount) {
  console.log(`[Backfill Fetch] Looking for ${neededCount} messages older than ID ${oldestStoredId}`);
  if (!client) return []; // Guard clause
  try {
    // Fetch messages *before* the oldest one we have.
    // reverse: true fetches older messages starting from offsetId downwards.
    const fetchLimit = Math.max(neededCount + 10, MESSAGE_FETCH_LIMIT); // Fetch a bit more than needed
    console.log(`   [Backfill Fetch] Using offsetId: ${oldestStoredId}, limit: ${fetchLimit}, reverse: true`);

    const messages = await client.getMessages(TELEGRAM_CHANNEL, {
      limit: fetchLimit,
      offsetId: oldestStoredId, // Start looking from the oldest ID we have
      addOffset: 0,
      reverse: true // Fetch messages with IDs less than offsetId
    });

    // Filter out any potentially invalid messages and ensure they are older
    const validMessages = messages.filter(msg => msg?.id && msg.id < oldestStoredId);
    console.log(`[Backfill Fetch] Found ${validMessages.length} raw messages older than ${oldestStoredId}.`);
    return validMessages; // Return them sorted oldest first by default from reverse=true

  } catch (error) {
    // Handle potential Telegram API errors gracefully
    if (error.message.includes('MESSAGE_ID_INVALID') && oldestStoredId === 1) {
      console.warn("[Backfill Fetch] MESSAGE_ID_INVALID at offset 1, likely reached beginning of channel history.");
    } else {
      console.error(`📩 [Backfill Fetch] Fetch Failed (around ID ${oldestStoredId}):`, error);
    }
    return [];
  }
}

// --- Fetch Latest Messages ---
async function fetchLatestMessages(client, redisMaxId) {
  console.log(`[New Fetch] Fetching messages newer than ID ${redisMaxId}`);
  if (!client) return []; // Guard clause

  try {
    // Fetch messages potentially newer than the last successfully processed ID
    // reverse: false gets newer messages (higher IDs)
    const messages = await client.getMessages(TELEGRAM_CHANNEL, {
      limit: MESSAGE_FETCH_LIMIT,
      offsetId: 0, // Fetch latest messages, filtering will happen based on redisMaxId
      addOffset: 0,
      reverse: false // Fetch newer messages
    });

    // Filter messages that are strictly newer than our last known processed ID
    const unprocessedNewer = messages.filter(msg => msg?.id && msg.id > redisMaxId);

    // --- Optional: Retry Failed Logic (Refined) ---
    const failedKeys = await redisClient.keys('failed:*');
    const failedIdsToRetry = failedKeys
      .map(k => parseInt(k.split(':')[1]))
      .filter(id => !isNaN(id) && id > redisMaxId); // Only retry failed IDs that are newer and valid numbers

    let failedMessages = [];
    if (failedIdsToRetry.length > 0) {
      console.log(`   [New Fetch] Attempting to retry ${failedIdsToRetry.length} failed IDs > ${redisMaxId}: ${failedIdsToRetry.join(', ')}`);
      try {
        // Fetch failed messages in batches or individually
        const fetchedFailed = await client.getMessages(TELEGRAM_CHANNEL, { ids: failedIdsToRetry });
        failedMessages = fetchedFailed.filter(msg => msg?.id && msg.id > redisMaxId); // Filter again after fetching
        console.log(`      [New Fetch] Successfully fetched ${failedMessages.length} previously failed messages for retry.`);
      } catch (fetchError) {
        console.error(`      [New Fetch] Error fetching some failed message IDs:`, fetchError);
        // Decide whether to remove failed keys if fetching fails repeatedly
        // for (const failedId of failedIdsToRetry) { await redisClient.del(`failed:${failedId}`); }
      }
    }
    // --- End Optional: Retry Failed Logic ---

    // Combine fetched newer messages and successfully fetched failed messages
    const combined = [...unprocessedNewer, ...failedMessages];

    // Deduplicate based on message ID
    const uniqueMessages = Array.from(new Map(combined.map(msg => [msg.id, msg])).values());

    console.log(`[New Fetch] Returning ${uniqueMessages.length} unique potential messages newer than ${redisMaxId}.`);
    return uniqueMessages;

  } catch (error) {
    console.error(`📩 [New Fetch] Fetch Failed (checking after ID ${redisMaxId}):`, error);
    return []; // Return empty array on failure
  }
}


// --- Polling Execution Logic ---
async function executePoll() {
  if (isPollingActive) {
    console.log('[POLL] Previous poll still running, skipping this cycle.');
    return;
  }

  isPollingActive = true;
  console.log(`\n🔄 [POLL] Cycle starting at ${new Date().toISOString()}`);

  let client = null; // Initialize client variable
  try {
    client = await getAuthorizedClient(); // Ensure client is ready
    if (!client) {
      throw new Error("Telegram client acquisition failed.");
    }

    const currentArticlesRaw = await redisClient.get('articles') || '[]';
    const currentArticles = JSON.parse(currentArticlesRaw);
    const currentArticleCount = currentArticles.length;
    const redisMaxId = parseInt(await redisClient.get('lastMaxId') || '0');

    console.log(`[POLL] Current state: ${currentArticleCount} articles stored. Last processed Max ID: ${redisMaxId}`);

    // --- Backfill Logic ---
    if (currentArticleCount < MAX_ARTICLES) {
      console.log(`[POLL] Article count (${currentArticleCount}) < target (${MAX_ARTICLES}). Attempting backfill.`);
      // Determine the starting point for backfill
      const oldestArticleId = currentArticles.length > 0
        ? Math.min(...currentArticles.map(a => a.id))
        : (redisMaxId > 0 ? redisMaxId + 1 : 1); // Start after last known max, or from 1 if totally empty

      if (oldestArticleId <= 1 && currentArticles.length > 0) {
        console.log("   [Backfill] Oldest article ID is 1, cannot backfill further.");
      } else {
        const neededCount = MAX_ARTICLES - currentArticleCount;
        const messagesToBackfill = await fetchMessagesForBackfill(client, oldestArticleId, neededCount);

        if (messagesToBackfill.length > 0) {
          console.log(`   [Backfill] Found ${messagesToBackfill.length} potential messages older than ${oldestArticleId}. Processing...`);
          let backfillSuccessCount = 0;
          // Process oldest first within the backfill batch to fill from the past forwards
          for (const message of messagesToBackfill.sort((a, b) => a.id - b.id)) {
            if (!message || !message.id) continue; // Skip invalid message objects

            // Skip if already processed (important check)
            const isProcessed = await redisClient.sIsMember(PROCESSED_SET, message.id.toString());
            if (isProcessed) {
              // console.log(`      [Backfill Skip] ${message.id} - already in PROCESSED_SET`);
              continue;
            }
            // Skip messages newer than redisMaxId if redisMaxId is set (shouldn't happen with correct fetching logic, but safe)
            if (redisMaxId > 0 && message.id > redisMaxId) {
              console.warn(`      [Backfill Skip] ${message.id} - newer than lastMaxId (${redisMaxId}) during backfill? Skipping.`);
              continue;
            }

            const success = await processAndStoreMessage(message);
            if (success) backfillSuccessCount++;

            // Optional: Early exit if target count is reached
            const currentCountCheck = JSON.parse(await redisClient.get('articles') || '[]').length;
            if (currentCountCheck >= MAX_ARTICLES) {
              console.log("      [Backfill] Target article count reached during backfill.");
              break;
            }
          }
          console.log(`   [Backfill] Attempted processing for ${messagesToBackfill.length} messages, ${backfillSuccessCount} succeeded.`);
        } else {
          console.log('   [Backfill] No older messages found to backfill.');
        }
      }

    }
    // --- End Backfill Logic ---

    // --- Fetch Newer Messages Logic ---
    console.log(`[POLL] Checking for new messages > ID ${redisMaxId}`);
    const newMessages = await fetchLatestMessages(client, redisMaxId);

    let newSuccessCount = 0;
    let highestProcessedIdThisCycle = redisMaxId; // Start with the last known max

    if (newMessages.length > 0) {
      console.log(`   [New Messages] Found ${newMessages.length} potential new messages. Processing...`);
      // Process newest first to prioritize recent content
      for (const message of newMessages.sort((a, b) => b.id - a.id)) {
        if (!message || !message.id) continue; // Skip invalid message objects

        // Critical check: Ensure we only process messages newer than the last *known* max ID
        if (message.id <= redisMaxId) {
          // console.log(`      [New Skip] ${message.id} - not newer than ${redisMaxId}`); // Can be verbose
          continue;
        }
        // Check processed set again (belt and suspenders)
        const isProcessed = await redisClient.sIsMember(PROCESSED_SET, message.id.toString());
        if (isProcessed) {
          // console.log(`      [New Skip] ${message.id} - already in PROCESSED_SET`);
          highestProcessedIdThisCycle = Math.max(highestProcessedIdThisCycle, message.id); // Still update max ID if a newer msg was skipped
          continue;
        }

        const success = await processAndStoreMessage(message);
        if (success) {
          newSuccessCount++;
          highestProcessedIdThisCycle = Math.max(highestProcessedIdThisCycle, message.id);
        }
      }
      console.log(`   [New Messages] Attempted processing for ${newMessages.length} messages, ${newSuccessCount} succeeded.`);
    } else {
      console.log('   [New Messages] No new messages found.');
    }
    // --- End Fetch Newer Messages Logic ---

    // --- Update lastMaxId ---
    // Get the absolute latest ID from Telegram *after* processing to handle potential gaps or deleted messages
    let finalTelegramMaxId = 0;
    try {
      finalTelegramMaxId = await getCurrentTelegramMaxId(client);
    } catch (telErr) {
      console.error("[POLL] Error fetching final Telegram max ID:", telErr);
    }

    // Determine the definitive new max ID: the highest processed in this cycle OR the current Telegram max ID, whichever is greater
    const newLastMaxId = Math.max(highestProcessedIdThisCycle, finalTelegramMaxId, redisMaxId);

    if (newLastMaxId > redisMaxId) {
      await redisClient.set('lastMaxId', newLastMaxId);
      console.log(`📈 [POLL] Updated lastMaxId from ${redisMaxId} to ${newLastMaxId}`);
    } else {
      console.log(`ℹ️ [POLL] lastMaxId remains ${redisMaxId}`);
    }

  } catch (error) {
    console.error('💥 [POLL] Critical error during poll cycle:', error);
    // Consider adding more robust error handling, e.g., backoff strategy
  } finally {
    isPollingActive = false;
    console.log(`🏁 [POLL] Cycle completed at ${new Date().toISOString()}`);
  }
}

// --- Initial System Startup ---
async function initializeSystem() {
  console.log('🚀 [Init] Starting system setup...');
  try {
    const client = await getAuthorizedClient();
    if (!client) throw new Error("Client initialization failed.");

    // --- Initialize API ID Counter if needed ---
    const counterExists = await redisClient.exists(ARTICLE_API_ID_COUNTER_KEY);
    if (!counterExists) {
      await redisClient.set(ARTICLE_API_ID_COUNTER_KEY, ARTICLE_API_ID_START);
      console.log(`   [Init] Initialized Article API ID counter (${ARTICLE_API_ID_COUNTER_KEY}) to ${ARTICLE_API_ID_START}.`);
    } else {
      const currentCounter = await redisClient.get(ARTICLE_API_ID_COUNTER_KEY);
      console.log(`   [Init] Article API ID counter (${ARTICLE_API_ID_COUNTER_KEY}) exists with value: ${currentCounter}.`);
    }

    // 1. Get current state from Redis
    let articles = JSON.parse(await redisClient.get('articles') || '[]');
    let lastMaxId = parseInt(await redisClient.get('lastMaxId') || '0');
    console.log(`   [Init] Found ${articles.length} articles and lastMaxId ${lastMaxId} in Redis.`);

    // 2. Get latest message ID from Telegram
    const telegramMaxId = await getCurrentTelegramMaxId(client);
    console.log(`   [Init] Current Telegram Max ID: ${telegramMaxId}`);

    // 3. Decide starting point for fetching initial articles
    // Fetch around the latest Telegram ID to ensure we get the newest,
    // even if Redis state is lagging or empty.
    const initialFetchOffsetId = telegramMaxId > 0 ? telegramMaxId + 1 : 0; // Start from latest + 1 or 0 if channel empty
    const fetchLimit = Math.max(MAX_ARTICLES * 2, MESSAGE_FETCH_LIMIT); // Fetch more initially

    console.log(`   [Init] Fetching initial batch of ~${fetchLimit} messages around ID ${initialFetchOffsetId}`);
    const initialMessages = await client.getMessages(TELEGRAM_CHANNEL, {
      limit: fetchLimit,
      offsetId: initialFetchOffsetId,
      addOffset: 0,
      reverse: true // Fetch newest first <= THIS WAS WRONG, should be false
    });
    // Corrected fetch direction for initial messages:
    const correctedInitialMessages = await client.getMessages(TELEGRAM_CHANNEL, {
      limit: fetchLimit,
      offsetId: 0, // Fetch latest
      addOffset: 0,
      reverse: false // Fetch newest first (correct)
    });


    console.log(`   [Init] Fetched ${correctedInitialMessages.length} initial messages.`);

    // 4. Process fetched messages if needed
    let initialProcessedCount = 0;
    const messagesToProcess = correctedInitialMessages // Use corrected fetch results
      .filter(msg => msg?.id && msg.id > lastMaxId) // Only process newer than Redis state
      .sort((a, b) => b.id - a.id); // Process newest first

    if (messagesToProcess.length > 0) {
      console.log(`   [Init] Processing ${messagesToProcess.length} messages newer than Redis lastMaxId.`);
      for (const message of messagesToProcess) {
        // Check if already in articles list (in case Redis had some state)
        if (articles.some(a => a.id === message.id)) continue;
        // Check if already processed/skipped
        const isProcessed = await redisClient.sIsMember(PROCESSED_SET, message.id.toString());
        if (isProcessed) continue;

        const success = await processAndStoreMessage(message); // Use the main processing function
        if (success) initialProcessedCount++;

        // Check if we've reached MAX_ARTICLES (optional optimization)
        // if (JSON.parse(await redisClient.get('articles') || '[]').length >= MAX_ARTICLES) {
        //     console.log("   [Init] Reached MAX_ARTICLES during initial processing.");
        //     break;
        // }
      }
      console.log(`   [Init] Processed ${initialProcessedCount} initial messages.`);
    } else {
      console.log(`   [Init] No new messages found to process based on Redis state (lastMaxId: ${lastMaxId}).`);
    }


    // 5. Final state update
    const finalArticles = JSON.parse(await redisClient.get('articles') || '[]');
    const finalHighestId = Math.max(
      lastMaxId,
      telegramMaxId,
      finalArticles.length > 0 ? Math.max(...finalArticles.map(a => a.id)) : 0
    );

    // Ensure lastMaxId reflects the absolute highest known ID after initialization
    if (finalHighestId > lastMaxId) {
      await redisClient.set('lastMaxId', finalHighestId);
      console.log(`   [Init] Updated lastMaxId to ${finalHighestId} after initialization.`);
    }

    console.log(`✅ [Init] Initialization complete. ${finalArticles.length} articles stored. Last Max ID: ${finalHighestId}`);

  } catch (error) {
    console.error('💥 [Init] Critical error during system initialization:', error);
    throw error; // Rethrow to prevent polling from starting if init fails
  }
}

// --- Start Polling ---
// Renamed to avoid auto-execution if imported elsewhere
async function startTelegramPolling() {
  try {
    await initializeSystem(); // Wait for initialization to complete
    console.log(`\n⏱️ [Polling] Starting polling cycle every ${POLL_INTERVAL / 1000} seconds...`);
    await executePoll(); // Run immediately once after init
    setInterval(executePoll, POLL_INTERVAL); // Start scheduled polling
  } catch (error) {
    console.error('💥 Polling initialization failed:', error);
    process.exit(1); // Exit if initialization or first poll fails
  }
}

// --- Execution (Conditional) ---
// Only start polling if this script is run directly
// This prevents polling from starting automatically if you import functions elsewhere
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startTelegramPolling();
} else {
  console.log(`[telegramService.js] Module loaded, but polling not started automatically.`);
}