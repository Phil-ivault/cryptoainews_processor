import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

// --- DOMPurify Setup ---
// Create a virtual DOM environment using JSDOM, which DOMPurify needs to run in Node.js.
const window = new JSDOM('').window;
// Initialize DOMPurify with the virtual window object.
const DOMPurify = createDOMPurify(window);

/**
 * Cleans and sanitizes content.
 * It first removes basic markdown formatting and then uses DOMPurify
 * to remove potentially harmful HTML and XSS vectors, allowing only specific tags.
 * @param {string} content - The raw content string to sanitize.
 * @param {object} [options={}] - Optional configuration (e.g., { maxLength: 5000 }).
 * @returns {string} The sanitized and truncated content string.
 */
export function sanitizeContent(content, options = {}) {
  if (!content) return ''; // Return empty string if input is null or undefined.

  try {
    // 1. Basic Markdown Cleaning: Remove common markdown syntax characters.
    // This is a simple removal, not a full markdown-to-HTML conversion.
    let cleaned = content.replace(/(\*\*|__|\*|_|`|~)/g, '');

    // 2. HTML Sanitization using DOMPurify:
    const sanitizeOptions = {
      ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'a', 'br', 'ul', 'ol', 'li'], // Allow basic text formatting + links & lists.
      ALLOWED_ATTR: ['href', 'target', 'rel'], // Allow specific attributes for 'a' tags.
      FORBID_TAGS: ['style', 'script', 'img', 'iframe', 'object'], // Explicitly forbid dangerous tags.
      KEEP_CONTENT: true, // Keep content of forbidden tags (can be set to false).
      ...options, // Allow overriding default options.
    };

    const sanitizedHtml = DOMPurify.sanitize(cleaned, sanitizeOptions);

    // 3. Truncate to a maximum length (default 5000 chars).
    return sanitizedHtml.substring(0, options.maxLength || 5000);

  } catch (error) {
    console.error('  [Validation] Sanitization error:', error);
    // Fallback: return the original content (truncated) on error.
    return content.substring(0, options.maxLength || 5000);
  }
}