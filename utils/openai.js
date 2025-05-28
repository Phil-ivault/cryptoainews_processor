import { OpenAI } from 'openai';
import { sanitizeContent } from './validation.js';
import dotenv from 'dotenv';

dotenv.config();

// --- Configuration ---
const MODEL_TIMEOUT = parseInt(process.env.MODEL_TIMEOUT) || 20000; // AI request timeout in ms.
const WORD_MIN = 200; // Minimum words for a valid article.
const WORD_MAX = 300; // Maximum words for a valid article.
const CHAR_MIN = 900; // Minimum characters for a valid article.
const CHAR_MAX = 3500; // Maximum characters for a valid article.

// Load OpenRouter API keys from environment.
const API_KEYS = process.env.OPENROUTER_API_KEYS?.split(',').filter(Boolean) || [];
if (API_KEYS.length === 0) {
  throw new Error('OPENROUTER_API_KEYS environment variable not configured');
}

// Load the list of models (primary and fallbacks combined) in order of preference.
// We now use a single environment variable for all models.
const MODELS = (process.env.OPENROUTER_MODELS || 'meta-llama/llama-3-70b-instruct')
  .split(',')
  .filter(Boolean);

if (MODELS.length === 0) {
  throw new Error('OPENROUTER_MODELS environment variable not configured or empty');
}


/**
 * Creates a short preview of content (first 20 words).
 * @param {string} content - The full content string.
 * @returns {string} A preview string.
 */
const getContentPreview = (content) => {
  if (!content) return '[No Content]';
  const words = content.split(/\s+/);
  return words.slice(0, 20).join(' ') + (words.length > 20 ? '...' : '');
};

/**
 * Counts the words in a string.
 * @param {string} str - The string to count words in.
 * @returns {number} The word count.
 */
const countWords = (str) => {
  if (!str) return 0;
  return str.replace(/[^\w\s]|_/g, "") // Remove punctuation
    .split(/\s+/) // Split by whitespace
    .filter(word => word.length > 0).length; // Filter empty strings
};


/**
 * Processes a Telegram message text to generate a news article.
 * It tries models from the OPENROUTER_MODELS list in order.
 * @param {string} text - The raw text from the Telegram message.
 * @param {number} messageId - The ID of the Telegram message for logging.
 * @param {string} validatedUrl - The source URL extracted from the message.
 * @returns {Promise<object|null>} An object with { headline, content, link } or null on failure.
 */
export async function processTelegramMessage(text, messageId, validatedUrl) {
  console.log(`\n[AI Processing] Starting for message ID: ${messageId}`);
  try {
    // Attempt to generate content using the consolidated list of models.
    let result = await tryModels(MODELS, text, messageId);

    // If a result was successfully generated, return it.
    if (result) {
      console.log(`✅ [AI Success] Message ID ${messageId} processed.`);
      return {
        ...result, // Contains headline and content
        link: validatedUrl
      };
    }

    // If no model succeeded, log and return null.
    console.warn(`❌ [AI Final Skip] Message ID ${messageId} - No valid content generated after all attempts.`);
    return null;

  } catch (error) {
    console.error(`💥 [AI Fatal Error] Processing ${messageId}: ${error.message}`);
    return null;
  }
}

/**
 * Iterates through the list of models and API keys to get a valid article.
 * @param {string[]} models - Array of model names to try (in order).
 * @param {string} text - The input text for the AI.
 * @param {number} messageId - The Telegram message ID for logging.
 * @returns {Promise<object|null>} An object with { headline, content } or null.
 */
async function tryModels(models, text, messageId) {
  // Iterate through each model in the provided list.
  for (const model of models) {
    // Iterate through each available API key (for rotation/fallback).
    for (const apiKey of API_KEYS) {
      const controller = new AbortController(); // For implementing timeouts.
      let timeoutHandle;

      try {
        console.log(`  [AI Attempt] ${messageId} -> ${model} (Key: ${apiKey.slice(0, 5)}...)`);
        const startTime = Date.now();

        // Configure the OpenAI client to use OpenRouter.
        const openai = new OpenAI({
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: apiKey,
          defaultHeaders: {
            "HTTP-Referer": process.env.SITE_URL, // Required by OpenRouter.
            "X-Title": process.env.SITE_NAME || "CryptoNews AI Processor" // Required by OpenRouter.
          }
        });

        // Create a timeout promise.
        const timeoutPromise = new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            controller.abort(); // Abort the API request on timeout.
            reject(new Error(`Timeout after ${MODEL_TIMEOUT}ms`));
          }, MODEL_TIMEOUT);
        });

        // Define the prompt with strict requirements.
        const completionPromise = openai.chat.completions.create({
          model,
          messages: [{
            role: "system",
            content: `STRICT REQUIREMENTS FOR CRYPTO NEWS ARTICLE:
1. HEADLINE: Must be exactly 5-7 words.
2. ARTICLE BODY: Must be between ${WORD_MIN} and ${WORD_MAX} words (approx ${CHAR_MIN}-${CHAR_MAX} characters).
3. CONTENT: Must be full sentences providing detailed analysis based ONLY on the user input. DO NOT add outside info or disclaimers.
4. FORMAT: MUST follow this structure EXACTLY, with 'Headline:' at the start:

Headline: [Your headline here]
[Your article content here]`
          }, {
            role: "user",
            content: `${text}\n\nREMEMBER: The article body must be ${WORD_MIN}-${WORD_MAX} words long and start AFTER the headline line.`
          }],
          temperature: 0.5,
          max_tokens: 3500,
          signal: controller.signal // Link to the abort controller.
        });

        // Race the completion against the timeout.
        const completion = await Promise.race([completionPromise, timeoutPromise]);
        clearTimeout(timeoutHandle); // Clear timeout if successful.

        // Validate the response.
        const responseContent = completion?.choices?.[0]?.message?.content;
        if (!responseContent) {
          console.warn(`    [AI API Error] ${model} - Malformed response.`);
          continue; // Try next key or model.
        }

        console.log(`    [AI Raw Response] ${model} (${Date.now() - startTime}ms): ${getContentPreview(responseContent)}`);

        // Extract and clean headline and content.
        const headlineMatch = responseContent.match(/^(?:#+\s*)?(?:headline|title|header):?\s*(.+)/mi);
        if (!headlineMatch || !headlineMatch[1]) {
          console.warn(`    [AI Rejected] ${model} - Missing or empty 'Headline:' line.`);
          continue;
        }
        const headline = headlineMatch[1].replace(/^[\s*_\-]+|[\s*_\-]+$/g, '').substring(0, 100).trim();
        const content = responseContent
          .replace(new RegExp(`^.*${headlineMatch[1]}.*$`, 'mi'), '')
          .replace(/^(?:#+\s*)?(?:headline|title|header):?\s*.+$/mi, '')
          .replace(/(\n\s*){3,}/g, '\n\n')
          .trim();
        const sanitized = sanitizeContent(content);

        // Validate word and character counts.
        const wordCount = countWords(sanitized);
        const charCount = sanitized.length;
        console.log(`    [AI Validation] ${model}: Words: ${wordCount} | Chars: ${charCount}`);

        if (wordCount < WORD_MIN || wordCount > WORD_MAX) {
          console.warn(`    [AI Rejected] ${model} - Word count (${wordCount}) out of bounds.`);
          continue;
        }
        if (charCount < CHAR_MIN || charCount > CHAR_MAX) {
          console.warn(`    [AI Rejected] ${model} - Char count (${charCount}) out of bounds.`);
          continue;
        }

        // Return successful result.
        return { headline, content: sanitized };

      } catch (error) {
        console.error(`    [AI Model Error] ${model} (Key: ${apiKey.slice(0, 5)}...): ${error.message}`);
      } finally {
        clearTimeout(timeoutHandle);
        if (!controller.signal.aborted) {
          controller.abort();
        }
      }
    }
  }
  // If no model/key succeeded, return null.
  return null;
}