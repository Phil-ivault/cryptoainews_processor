import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

export function sanitizeContent(content, options = {}) {
  try {
    // First clean markdown
    let cleaned = content.replace(/(\*\*|__|\*|_|`|~)/g, '');

    // Then sanitize HTML
    const sanitizeOptions = {
      ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'a'],
      ALLOWED_ATTR: ['href', 'target', 'rel'],
      FORBID_TAGS: ['style', 'script'],
      KEEP_CONTENT: true,
      ...options,
    };

    return DOMPurify.sanitize(cleaned, sanitizeOptions)
      .substring(0, options.maxLength || 5000); // Increased max length
  } catch (error) {
    console.error('Sanitization error:', error);
    return content.substring(0, options.maxLength || 5000);
  }
}