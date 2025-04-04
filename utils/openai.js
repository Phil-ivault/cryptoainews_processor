import { OpenAI } from 'openai';
import { sanitizeContent } from './validation.js';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const MODEL_TIMEOUT = 20000;
const WORD_MIN = 200;
const WORD_MAX = 300;
const CHAR_MIN = 900;
const CHAR_MAX = 3500;

const API_KEYS = process.env.OPENROUTER_API_KEYS?.split(',').filter(Boolean) || [];
if (API_KEYS.length === 0) {
  throw new Error('OPENROUTER_API_KEYS environment variable not configured');
}

const MODELS = process.env.OPENROUTER_MODELS?.split(',').filter(Boolean) || [];
const FALLBACK_MODELS = process.env.OPENROUTER_FALLBACK_MODELS?.split(',').filter(Boolean) || [];

// Helper function for content preview
const getContentPreview = (content) => {
  const words = content.split(/\s+/);
  return words.slice(0, 20).join(' ') + (words.length > 20 ? '...' : '');
};

export async function processTelegramMessage(text, messageId, validatedUrl) {
  console.log(`\n[Processing] Starting ${messageId}`);
  try {
    let result = await tryModels(MODELS, text, messageId);

    // Only attempt fallback if no successful result
    if (!result && FALLBACK_MODELS.length > 0) {
      console.log(`[Fallback] Trying ${FALLBACK_MODELS.length} fallback models for ${messageId}`);
      result = await tryModels(FALLBACK_MODELS, text, messageId);
    }

    // Early return on success
    if (result) {
      console.log(`[Success] ${messageId} Processed...`);
      return {
        ...result,
        link: validatedUrl
      };
    }

    console.log(`[Final Skip] ${messageId} - No valid content generated`);
    return null;

  } catch (error) {
    console.error(`[Fatal Error] ${messageId}: ${error.message}`);
    return null;
  }
}

async function tryModels(models, text, messageId) {
  const countWords = (str) => str.replace(/[^\w\s]|_/g, "")
    .split(/\s+/)
    .filter(word => word.length > 0).length;

  for (const model of models) {
    for (const apiKey of API_KEYS) {
      const controller = new AbortController();
      let timeoutHandle;

      try {
        console.log(`[Model Attempt] ${messageId} -> ${model} (Key: ${apiKey.slice(0, 5)}...)`);
        const startTime = Date.now();

        const openai = new OpenAI({
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: apiKey,
          defaultHeaders: {
            "HTTP-Referer": process.env.SITE_URL,
            "X-Title": process.env.SITE_NAME || "CryptoNews AI Processor"
          }
        });

        const timeoutPromise = new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            controller.abort();
            reject(new Error(`Timeout after ${MODEL_TIMEOUT}ms`));
          }, MODEL_TIMEOUT);
        });

        const completionPromise = openai.chat.completions.create({
          model,
          messages: [{
            role: "system",
            content: `STRICT REQUIREMENTS FOR CRYPTO NEWS ARTICLE:
1. HEADLINE: 5-7 words exactly
2. ARTICLE BODY: ${WORD_MIN}-${WORD_MAX} words (${CHAR_MIN}-${CHAR_MAX} characters)
3. USE FULL SENTENCES WITH DETAILED ANALYSIS
4. FORMAT STRICTLY AS:

Headline: [Your headline here]
[Your article content here]`
          }, {
            role: "user",
            content: `${text}\n\nIMPORTANT: Article must be ${WORD_MIN}-${WORD_MAX} words!`
          }],
          temperature: 0.5,
          max_tokens: 3500,
          signal: controller.signal
        });

        const completion = await Promise.race([completionPromise, timeoutPromise]);
        clearTimeout(timeoutHandle);

        if (!completion?.choices?.[0]?.message?.content) {
          console.log(`[API Error] ${model} - Malformed response (Key: ${apiKey.slice(0, 5)}...)`);
          continue;
        }

        const response = completion.choices[0].message.content;
        console.log(`[Raw Response] ${model} (${Date.now() - startTime}ms):
          ${getContentPreview(response)}`);

        // Headline extraction
        const headlineMatch = response.match(/^Headline:\s*(.+)$/mi);
        if (!headlineMatch) {
          console.log(`[Rejected] ${model} - Missing headline (Key: ${apiKey.slice(0, 5)}...)`);
          continue;
        }

        const headline = headlineMatch[1]
          .replace(/[*_~`"']/g, '')
          .substring(0, 100)
          .trim();

        // Content extraction
        const content = response.replace(/^.*Headline:\s*/mi, '').trim();
        const sanitized = sanitizeContent(content);

        console.log(`[Parsed] ${model}:
          Headline: "${headline}"
          Content: ${getContentPreview(sanitized)}`);

        // Validation checks
        const wordCount = countWords(sanitized);
        const charCount = sanitized.length;

        console.log(`[Validation] ${model}:
          Words: ${wordCount}/${WORD_MIN}-${WORD_MAX}
          Chars: ${charCount}/${CHAR_MIN}-${CHAR_MAX}`);

        if (wordCount < WORD_MIN || wordCount > WORD_MAX) {
          console.log(`[Rejected] ${model} - Word count out of bounds`);
          continue;
        }

        if (charCount < CHAR_MIN || charCount > CHAR_MAX) {
          console.log(`[Rejected] ${model} - Character count out of bounds`);
          continue;
        }

        return { headline, content };

      } catch (error) {
        console.log(`[Model Error] ${model} (Key: ${apiKey.slice(0, 5)}...): ${error.message}`);
        console.log(`[Error Context] Message: ${messageId}, Model: ${model}`);
      } finally {
        clearTimeout(timeoutHandle);
        controller.abort();
      }
    }
  }
  return null;
}