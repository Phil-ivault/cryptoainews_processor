import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// --- Helmet Configuration ---
// Helmet helps secure Express apps by setting various HTTP headers.
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      // Default policy: only allow resources from the same origin ('self').
      defaultSrc: ["'self'"],
      // Allow scripts from 'self' and 'unsafe-inline' (needed for some simple frontend setups, review if possible).
      scriptSrc: ["'self'", "'unsafe-inline'"],
      // Allow styles from 'self', 'unsafe-inline', and Google Fonts.
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      // Allow images from 'self', data URIs, and Telegram (for potential avatars/media).
      imgSrc: ["'self'", "data:", "https://*.telegram.org"],
      // Allow connections (like fetch/XHR) to 'self' and Telegram API.
      connectSrc: ["'self'", "https://api.telegram.org"],
      // Allow fonts from 'self' and Google Fonts.
      fontSrc: ["'self'", "fonts.gstatic.com"]
    }
  },
  // Further HSTS, XSS protection, etc., are enabled by default in helmet().
});

// --- Rate Limiting Configuration ---

/**
 * Global rate limiter: Applies to all incoming requests.
 * A broad limit to prevent general abuse.
 */
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1-minute window.
  max: 200, // Max 200 requests per window from *all* sources (less effective without IP).
  message: "Too many requests, please try again later.",
  standardHeaders: true, // Send standard `RateLimit-*` headers.
  legacyHeaders: false, // Don't send `X-RateLimit-*` headers.
  // NOTE: This global limiter isn't IP-based, it's a very basic total requests limit.
  // The IP limiter below is more targeted. Consider if this global one is needed.
});

/**
 * IP-based rate limiter: Applies a stricter limit per IP address.
 * Helps prevent abuse from a single source.
 * Relies on Express 'trust proxy' setting in app.js to work correctly behind proxies.
 */
export const ipRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1-minute window.
  max: 50, // Max 50 requests per minute per IP. Adjust as needed.
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use the 'X-Forwarded-For' header if available (from proxy), otherwise use remoteAddress.
    // It's crucial that app.set('trust proxy', ...) is configured correctly in app.js.
    const forwarded = req.headers['x-forwarded-for'];
    return forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
  },
  skip: (req) => {
    // Example: Allows skipping rate limiting for specific health check endpoints.
    return req.originalUrl.startsWith('/healthcheck');
  }
});

// --- Security Middleware Array ---
// Exports an array containing all security middleware for easy application in app.js.
export const securityMiddleware = [
  // 1. CORS: Controls which origins can access your API.
  cors({
    // Only allows requests from the URL defined in SITE_URL. CRITICAL for security.
    origin: process.env.SITE_URL,
    optionsSuccessStatus: 200 // For legacy browser compatibility.
  }),
  // 2. Helmet: Sets various security-related HTTP headers.
  helmetConfig,
  // 3. Rate Limiters: Apply the defined rate limits.
  // Note: Order might matter depending on your needs. IP limiter often comes first.
  ipRateLimiter,
  globalRateLimiter, // Consider if both are needed or if IP is sufficient.
];