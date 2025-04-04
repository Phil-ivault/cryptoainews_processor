import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { processTelegramMessage } from '../../utils/openai.js';
import { redisClient } from '../../utils/redis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

// Configuration
const TELEGRAM_CHANNEL = process.env.TELEGRAM_CHANNEL;
const MAX_ARTICLES = parseInt(process.env.MAX_ARTICLES) || 25;
const MESSAGE_FETCH_LIMIT = parseInt(process.env.MESSAGE_FETCH_LIMIT) || 25;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 120000;
const PROCESSED_SET = 'processed_ids';
const LOCK_TTL = parseInt(process.env.PROCESSING_LOCK_TTL) || 60; // seconds
let isPollingActive = false;

// Environment validation
const validateEnvironment = () => {
  const requiredVars = [
    'TELEGRAM_API_ID',
    'TELEGRAM_API_HASH',
    'TELEGRAM_SESSION_STRING'
  ];

  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      throw new Error(`Missing ${varName} in environment`);
    }
  });

  return [Number(process.env.TELEGRAM_API_ID), process.env.TELEGRAM_API_HASH];
};

const [apiId, apiHash] = validateEnvironment();
const session = new StringSession(process.env.TELEGRAM_SESSION_STRING);
let clientInstance = null;

// Client initialization
async function getAuthorizedClient() {
  if (clientInstance?.connected) return clientInstance;

  try {
    clientInstance = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true,
      autoReconnect: true
    });

    console.log('⌛ Connecting to Telegram...');
    await clientInstance.connect();

    if (!(await clientInstance.checkAuthorization())) {
      throw new Error('Invalid session. Regenerate with phone login.');
    }

    console.log('✅ Telegram authorization successful');
    return clientInstance;
  } catch (error) {
    console.error('💥 Telegram connection failed:', error);
    process.exit(1);
  }
}

// Core processing function
async function processAndStoreMessage(message) {
  const msgId = message.id;
  const lockKey = `lock:${msgId}`;

  try {
    // 1. Acquire processing lock
    const lockAcquired = await redisClient.set(lockKey, '1', { NX: true, EX: LOCK_TTL });
    if (!lockAcquired) {
      console.log(`⏩ Skipping ${msgId} - processing in progress`);
      return true;
    }

    // 2. Check processed set
    const isProcessed = await redisClient.sIsMember(PROCESSED_SET, msgId.toString());
    if (isProcessed) {
      console.log(`⏩ Skipping ${msgId} - already processed`);
      return true;
    }

    // 3. Existing article check
    const existing = JSON.parse(await redisClient.get('articles') || '[]');
    if (existing.some(a => a.id === msgId)) {
      console.log(`⏩ Skipping ${msgId} - exists in articles`);
      return true;
    }

    // URL validation
    const rawText = message.text?.substring(0, 1500) || '';
    const entities = message.entities || [];
    const extractedUrl = extractValidUrl(rawText, entities);

    if (!extractedUrl) {
      console.log(`📭 Skipping ${msgId} - No valid URL found`);
      await redisClient.sAdd(PROCESSED_SET, msgId.toString());
      return true;
    }

    // Process message
    const processed = await processTelegramMessage(rawText, msgId, extractedUrl);
    if (!processed?.headline || processed.content?.length < 30) {
      throw new Error('Invalid article format');
    }

    // Clean headline
    processed.headline = processed.headline
      .replace(/[*_~`"']/g, '')
      .trim()
      .substring(0, 100);

    // Update articles
    const currentArticles = JSON.parse(await redisClient.get('articles') || '[]');
    const updated = [
      ...currentArticles.filter(a => a.id !== msgId),
      {
        id: msgId,
        headline: processed.headline,
        article: processed.content,
        source: extractedUrl,
        date: new Date().toISOString(),
        views: Math.floor(Math.random() * 1700) + 1200,
        status: 'processed'
      }
    ].sort((a, b) => b.id - a.id).slice(0, MAX_ARTICLES);

    // Atomic transaction
    const multi = redisClient.multi()
      .sAdd(PROCESSED_SET, msgId.toString())
      .del(`failed:${msgId}`)
      .set('articles', JSON.stringify(updated));

    await multi.exec();
    console.log(`✅ Stored article ${msgId} with valid URL`);
    return true;

  } catch (error) {
    console.error(`❌ Storage rejected ${msgId}:`, error.message);
    await redisClient.set(`failed:${msgId}`, '1', { EX: 3600 });
    return false;
  } finally {
    await redisClient.del(lockKey);
  }
}

// URL extraction
function extractValidUrl(text, entities = []) {
  try {
    // Check Telegram entities first
    const urlEntity = entities.find(e =>
      e.className === 'MessageEntityTextUrl' || e.type === 'textUrl'
    );
    if (urlEntity?.url) {
      const parsed = new URL(urlEntity.url);
      if (isValidHttpUrl(parsed)) return parsed.toString();
    }

    // Regex fallback
    const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
    const matches = text.match(urlRegex) || [];

    for (const url of matches) {
      try {
        const parsed = new URL(url);
        if (isValidHttpUrl(parsed)) return parsed.toString();
      } catch (_) { }
    }

    return null;
  } catch (error) {
    return null;
  }
}

function isValidHttpUrl(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

// Message fetching
async function fetchLatestMessages() {
  try {
    const client = await getAuthorizedClient();

    // Get lastMaxId FIRST
    const lastMaxId = parseInt(await redisClient.get('lastMaxId') || 0);

    // Get messages newer than last processed ID
    const messages = await client.getMessages(TELEGRAM_CHANNEL, {
      limit: MESSAGE_FETCH_LIMIT,
      offsetId: lastMaxId + 1,
      addOffset: 0,
      reverse: false
    });

    // Retrieve processed IDs
    const processedIds = new Set(
      await redisClient.sMembers(PROCESSED_SET)
    );

    // SYNC filter (no await in filter)
    const unprocessed = messages.filter(msg =>
      !processedIds.has(msg.id.toString()) &&
      msg.id >= lastMaxId + 1
    );

    // Handle retries
    const failedKeys = await redisClient.keys('failed:*');
    const failedIds = failedKeys.map(k => parseInt(k.split(':')[1]));

    const failedMessages = await Promise.all(
      failedIds.map(async id => {
        try {
          return await client.getMessages(TELEGRAM_CHANNEL, { ids: id });
        } catch (error) {
          console.log(`[Retry Failed] Could not fetch message ${id}:`, error);
          return null;
        }
      })
    );

    return [
      ...unprocessed,
      ...failedMessages.flat().filter(msg => msg?.id)
    ];
  } catch (error) {
    console.error('📩 Fetch Failed:', error);
    return [];
  }
}

// Initialization system
async function initializeSystem() {
  try {
    console.log('❄️ Cold Start: Initializing from Telegram...');
    const client = await getAuthorizedClient();

    // Get latest messages
    const latestMessages = await client.getMessages(TELEGRAM_CHANNEL, {
      limit: 1,
      reverse: false
    });
    const telegramMaxId = latestMessages[0]?.id || 0;

    // Fetch historical messages
    const freshMessages = await client.getMessages(TELEGRAM_CHANNEL, {
      limit: MAX_ARTICLES,
      offsetId: telegramMaxId + 1,
      addOffset: 0,
      reverse: false
    });

    // Deduplicate and process
    const allMessages = [...latestMessages, ...freshMessages]
      .filter((msg, idx, self) =>
        self.findIndex(m => m.id === msg.id) === idx
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, MAX_ARTICLES * 2);

    const existingArticles = JSON.parse(await redisClient.get('articles') || '[]');
    const newMessages = allMessages.filter(msg =>
      !existingArticles.some(a => a.id === msg.id)
    );

    // Process new messages
    for (const message of newMessages) {
      await processAndStoreMessage(message);
    }

    // Final cleanup
    const finalArticles = JSON.parse(await redisClient.get('articles') || '[]');
    if (finalArticles.length > MAX_ARTICLES) {
      await redisClient.set('articles', JSON.stringify(finalArticles.slice(0, MAX_ARTICLES)));
    }

    await redisClient.set('lastMaxId', telegramMaxId);
    console.log(`🔄 Cold Start Complete: ${newMessages.length} new messages processed`);

  } catch (error) {
    console.error('💥 Cold Start Failed:', error);
    throw error;
  }
}

// Polling system
async function executePoll() {
  if (isPollingActive) {
    console.log('[POLL] Previous poll still running, skipping');
    return;
  }

  isPollingActive = true;
  try {
    // Get current ID BEFORE fetching
    const currentLastMaxId = parseInt(await redisClient.get('lastMaxId'));

    // Enhanced log
    console.log(`[POLL] Checking for messages newer than ID ${currentLastMaxId}...`);
    const messages = await fetchLatestMessages();
    const validMessages = messages.filter(msg => msg?.id);

    if (validMessages.length === 0) {
      console.log('[POLL] No valid messages found');
      return;
    }

    let successCount = 0;
    let highestProcessedId = 0; // Track the highest successfully processed ID
    const failedIds = [];

    // Process messages in descending order (newest first)
    for (const message of validMessages.sort((a, b) => b.id - a.id)) {
      try {
        const success = await processAndStoreMessage(message);
        if (success) {
          successCount++;
          // Update the highest processed ID
          if (message.id > highestProcessedId) {
            highestProcessedId = message.id;
          }
        } else {
          failedIds.push(message.id);
        }
      } catch (error) {
        console.error(`[Poll Error] ${message?.id || 'unknown'}:`, error);
      }
    }

    // Update lastMaxId ONLY if new messages were processed
    if (highestProcessedId > 0) {
      const currentLastMaxId = parseInt(await redisClient.get('lastMaxId') || 0);
      if (highestProcessedId > currentLastMaxId) {
        await redisClient.set('lastMaxId', highestProcessedId);
        console.log(`🆕 Updated lastMaxId to ${highestProcessedId}`);
      }
    }

    console.log(`[POLL] Processed ${successCount}/${validMessages.length} messages`);
    if (failedIds.length > 0) {
      console.log('❌ Failed IDs:', failedIds.join(', '));
    }
  } catch (error) {
    console.error('[POLL] Critical error:', error);
  } finally {
    isPollingActive = false;
    console.log(`[POLL] Cycle completed at ${new Date().toISOString()}`);
  }
}

// Main initialization
async function initializePolling() {
  try {
    console.log('⚙️ Starting cold initialization...');
    await initializeSystem();
    console.log('⏱ Initial polling sequence starting');
    await executePoll();
    setInterval(executePoll, POLL_INTERVAL);
    console.log(`🔄 Auto-polling activated every ${POLL_INTERVAL / 1000} seconds`);
  } catch (error) {
    console.error('💥 Polling initialization failed:', error);
    process.exit(1);
  }
}

initializePolling();

export { getAuthorizedClient, fetchLatestMessages, processAndStoreMessage };
