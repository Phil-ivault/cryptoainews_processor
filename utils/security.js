import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https://*.telegram.org"],
      connectSrc: [
        "'self'",
        "https://api.telegram.org",
      ],
      fontSrc: ["'self'", "fonts.gstatic.com"]
    }
  },
});

// Global rate limiter for all requests
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1-minute window
  max: 200, // Total requests per window
  message: "Too many requests, please try again later.",
  validate: { trustProxy: false }, // Let Express handle proxy validation
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable legacy headers
  keyGenerator: (req) => {
    // Use the X-Forwarded-For header if proxy is trusted
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  }
});

// IP-specific rate limiter
export const ipRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 25,
  message: "Too many requests from this IP",
  validate: {
    trustProxy: true // Trust proxy for IP validation
  },
  keyGenerator: (req) => {
    // Get first IP in chain if behind proxy
    const forwardHeader = req.headers['x-forwarded-for'];
    return forwardHeader
      ? forwardHeader.split(',')[0].trim()
      : req.socket.remoteAddress;
  },
  skip: (req) => {
    // Optional: Skip rate limiting for certain paths
    return req.originalUrl.startsWith('/healthcheck');
  }
});

export const securityMiddleware = [
  cors({
    origin: process.env.SITE_URL || 'https://your-render-url.onrender.com',
    optionsSuccessStatus: 200
  }),
  helmetConfig,
  globalRateLimiter,
  ipRateLimiter
];