## CryptoAINews Aggregator

**Version:** 1.0

**Description:** An AI-powered news aggregator that fetches crypto-related news from a Telegram channel, processes it using AI (via OpenRouter), caches data using Redis, and displays it on a simple web frontend.

### Features

* Fetches messages from a specified Telegram channel.
* Uses AI models via OpenRouter to generate concise news headlines and summaries from Telegram messages.
* Utilizes Redis for caching processed articles and cryptocurrency prices.
* Fetches cryptocurrency prices from the CoinGecko API.
* Provides a web interface to display cached articles and prices.
* Includes rate limiting (global and per-IP) and basic security middleware.
* Supports deployment on various platforms (Render, Heroku, AWS).

### Prerequisites

Before you begin, ensure you have the following:

1.  **Node.js and npm:** Download and install from [nodejs.org](https://nodejs.org/).
2.  **Telegram API Credentials:**
    * `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`: Obtain these from [my.telegram.org](https://my.telegram.org/).
    * `TELEGRAM_SESSION_STRING`: You'll need to generate this by running a script locally (often involving logging in with your phone number via the terminal using the Telegram library). *Note: The codebase doesn't include a script for this; you may need to create one or find instructions specific to the 'telegram' library version used.*
3.  **OpenRouter API Key(s):** Get API keys from [openrouter.ai](https://openrouter.ai/) for AI processing.
4.  **Redis Instance:** You need access to a Redis database. You can run one locally using Docker or use a cloud provider (like Redis Cloud on Render, Heroku Redis, or AWS ElastiCache).

### Environment Variables

Create a `.env` file in the root directory by copying `.env.example` (`cp .env.example .env`) and filling in your actual credentials and settings.

```env
# ==============================================
#             REQUIRED SETTINGS
# ==============================================

# ----- Telegram Configuration -----
TELEGRAM_API_ID=your_telegram_app_id            # Your Telegram API ID from my.telegram.org
TELEGRAM_API_HASH=your_telegram_app_hash        # Your Telegram API Hash from my.telegram.org
TELEGRAM_SESSION_STRING=your_telegram_session_string # Generated Telegram session string
TELEGRAM_CHANNEL=officialcryptochannel          # Target Telegram channel username (e.g., wublockchainenglish)

# ----- OpenRouter AI Configuration -----
OPENROUTER_API_KEYS=your_key1,your_key2         # Comma-separated list of your OpenRouter API keys
OPENROUTER_MODELS=meta-llama/llama-3-70b-instruct:free # Primary AI model(s) to use
OPENROUTER_FALLBACK_MODELS=google/palm-2:free,anthropic/claude-3-haiku:free # Fallback AI model(s) if primary fails

# ----- Redis Configuration -----
REDIS_URL=redis://:password@host:port           # Connection URL for your Redis instance (e.g., redis://localhost:6379 for local)

# ==============================================
#            APPLICATION SETTINGS
# ==============================================

# ----- Core Functionality -----
CRYPTO_SYMBOLS=BTC:bitcoin,ETH:ethereum,SOL:solana # Comma-separated list of Symbol:CoingeckoID pairs for price fetching
MESSAGE_FETCH_LIMIT=25                          # How many messages to fetch from Telegram per poll cycle
AI_MAX_RETRIES=3                                # Max AI processing retries per message before giving up
PROCESSING_LOCK_TTL=60                          # How long (in seconds) to lock a message ID during processing to prevent duplicate processing by multiple instances

# ----- Branding & Display -----
SITE_NAME=CryptoAINews                          # Name displayed in logs
SITE_URL=https://yourdomain.com                 # Your application's public URL (used in logs and CORS)

# ----- Performance & Security -----
PORT=3000                                       # Port the server will listen on (provider might override via PORT env var)
NODE_ENV=production                             # Set to 'development' for more verbose logs, 'production' for optimized performance
FORCE_HTTPS=true                                # Set to true if your hosting provider forces HTTPS redirection
PROXY_TRUST_LEVEL=1                             # How many proxy hops to trust for rate limiting (e.g., 1 for Render/Heroku, adjust for Cloudflare/AWS ALB)

# ==============================================
#            ADVANCED SETTINGS
# ==============================================

# ----- Redis Maintenance -----
DO_FLUSH_REDIS=false                            # Set to 'true' ONLY for the very first deployment to clear Redis, then set to 'false'

# ----- Price Tracking -----
PRICE_POLL_INTERVAL=60000                       # How often (in ms) to fetch new crypto prices (60000 = 1 min)
PRICE_HISTORY_LIMIT=1440                        # How many price points to keep per symbol in history (e.g., 1440 points = 24 hours if polling every minute)

# ----- Rate Limiting -----
GLOBAL_RATE_LIMIT=200                           # Max total requests allowed per minute across all IPs
IP_RATE_LIMIT=25                                # Max requests allowed per minute from a single IP address

# --- Optional Redis settings from original readme (defaults are usually fine) ---
# REDIS_TLS=true
# REDIS_CERT=/etc/ssl/certs/
# REDIS_RETRY_STRATEGY=3
# --- Other Optional Settings from original readme ---
# REQUEST_TIMEOUT=30000                         # Timeout for AI requests in milliseconds
# POLL_INTERVAL=120000                          # How often (in ms) to check Telegram for new messages (120000 = 2 mins) - Note: Price polling is separate (PRICE_POLL_INTERVAL)
# MAX_ARTICLES=25                               # Max number of articles to keep in cache
```

### Local Setup Instructions

1.  **Clone the repository:** `git clone <your-repo-url>`
2.  **Navigate to the directory:** `cd cryptoainews_processor`
3.  **Install dependencies:** `npm install`
4.  **Create `.env` file:** `cp .env.example .env`
5.  **Populate `.env` file:** Edit the `.env` file and fill in your actual credentials and desired settings.
6.  **Ensure Redis is running** and accessible via the `REDIS_URL` you provided.
7.  **Run pre-start check:** `npm run prestart` (Checks for essential env vars)
8.  **Start the development server:** `npm run dev` (Uses nodemon for auto-restarts)
    * *Alternatively, for a production-like start:* `NODE_ENV=production npm start`
9.  **Access the application:** Open your browser to `http://localhost:3000` (or the `PORT` specified).

### Deployment Guides

**General Notes:**

* **Environment Variables:** You MUST configure all the required environment variables from the `.env` section above within your chosen hosting provider's interface. Do NOT commit your `.env` file.
* **Redis:** Ensure you provision a Redis instance on your chosen platform and configure the `REDIS_URL`.
* **`DO_FLUSH_REDIS`:** Remember to set `DO_FLUSH_REDIS=true` **only** for the *first deployment* if you want to start with a clean Redis database. Immediately after the first successful deployment, change it to `DO_FLUSH_REDIS=false` to prevent data loss on subsequent deploys.

**1. Render.com**

1.  **Create Account:** Sign up or log in at [render.com](https://render.com/).
2.  **Create Redis:**
    * Go to "Blueprints" or "New +" -> "Redis".
    * Choose a plan (e.g., free tier for testing).
    * Once created, copy the **"Internal Redis URL"**.
3.  **Create Web Service:**
    * Go to "New +" -> "Web Service".
    * Connect your Git repository (GitHub, GitLab, etc.).
    * **Settings:**
        * **Name:** Choose a name (e.g., `cryptonews-app`).
        * **Region:** Select a region close to you or your users.
        * **Branch:** `main` (or your deployment branch).
        * **Root Directory:** `/` (if `package.json` is in the root).
        * **Build Command:** `npm install`
        * **Start Command:** `node --experimental-network-imports server.js` (The `prestart` script runs automatically before `start`)
        * **Instance Type:** Choose a plan (e.g., free tier).
4.  **Add Environment Variables:**
    * Go to the "Environment" tab for your Web Service.
    * Add all the variables from the `.env` section above. Use the **Internal Redis URL** copied earlier for `REDIS_URL`.
    * Set `SITE_URL` to your Render service URL (e.g., `https://cryptonews-app.onrender.com`).
    * Set `NODE_ENV=production`.
    * Set `DO_FLUSH_REDIS=true` for the first deploy.
5.  **Deploy:** Click "Create Web Service".
6.  **Update `DO_FLUSH_REDIS`:** After the first deployment succeeds, go back to Environment Variables and change `DO_FLUSH_REDIS` to `false`. Redeploy if necessary.

**2. Heroku**

1.  **Create Account & Install CLI:** Sign up at [heroku.com](https://heroku.com/) and install the [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli).
2.  **Login:** `heroku login`
3.  **Create App:** `heroku create your-app-name` (or `heroku create` for a random name).
4.  **Add Redis:** `heroku addons:create heroku-redis:mini` (or choose a different plan). This automatically sets the `REDIS_URL` config var.
5.  **Set Environment Variables:**
    * Use the Heroku CLI or the Dashboard (Settings -> Config Vars).
    * `heroku config:set TELEGRAM_API_ID=YOUR_API_ID TELEGRAM_API_HASH=YOUR_API_HASH ...`
    * Add all variables from the `.env` section *except* `REDIS_URL` (it's set by the addon).
    * Set `SITE_URL` to your Heroku app URL (e.g., `https://your-app-name.herokuapp.com`).
    * Set `NODE_ENV=production`.
    * Set `DO_FLUSH_REDIS=true` for the first deploy.
6.  **Deploy:**
    * Commit your code: `git add .`, `git commit -m "Prep for Heroku"`
    * Push to Heroku: `git push heroku main` (or your branch name). Heroku automatically detects Node.js and runs `npm start`.
7.  **Update `DO_FLUSH_REDIS`:** After the first deploy, use `heroku config:set DO_FLUSH_REDIS=false` or the dashboard to update the variable.

**3. AWS (Elastic Beanstalk)**

*Note: This is more complex than Render/Heroku.*

1.  **Create Account & Setup:** Sign up at [aws.amazon.com](https://aws.amazon.com/). You might need to configure AWS CLI locally.
2.  **Create ElastiCache Redis:**
    * Go to the AWS ElastiCache console.
    * Create a Redis cluster (e.g., `cache.t3.micro` for testing).
    * Configure security groups to allow inbound connections from your future Elastic Beanstalk environment's security group (on port 6379).
    * Note the **Primary Endpoint** URL for your Redis cluster.
3.  **Prepare Code:** Zip your project files (excluding `node_modules` and `.env`).
4.  **Create Elastic Beanstalk Application & Environment:**
    * Go to the Elastic Beanstalk console.
    * Create a new Application.
    * Create a new Environment within the application.
        * **Platform:** Select "Node.js".
        * **Application code:** Upload your zip file.
5.  **Configure Environment:**
    * Go to your Environment -> Configuration -> Software -> Environment properties.
    * Add all the environment variables from the `.env` section.
    * For `REDIS_URL`, construct it using the ElastiCache Primary Endpoint (e.g., `redis://your-redis-endpoint.xxxxxx.cache.amazonaws.com:6379`). If you enabled authentication, include the password.
    * Set `SITE_URL` to your Elastic Beanstalk environment URL.
    * Set `NODE_ENV=production`.
    * Set `DO_FLUSH_REDIS=true` for the first deploy.
    * Ensure the `npm start` command is used (usually the default for Node.js platforms).
6.  **Configure Security Groups:**
    * Ensure the Elastic Beanstalk environment's security group can access the ElastiCache Redis security group on port 6379.
    * Ensure the EB security group allows inbound traffic on HTTP/HTTPS (port 80/443).
7.  **Deploy:** The environment should build and deploy automatically after creation/configuration.
8.  **Update `DO_FLUSH_REDIS`:** After the first deploy, update the environment property to `false`.

### Connecting a Custom Domain

**General Steps:**

1.  **Domain Registrar:** Purchase a domain name from a registrar (e.g., GoDaddy, Namecheap, Google Domains).
2.  **Hosting Provider:** Add your custom domain to your hosting platform (Render, Heroku, AWS). They will provide you with a target URL/value (often a CNAME target like `your-app.onrender.com` or similar).
3.  **DNS Configuration:** Go to your domain registrar's DNS management panel.
    * **For `www` subdomain (e.g., `www.yourdomain.com`):** Create a `CNAME` record.
        * **Type:** `CNAME`
        * **Name/Host:** `www`
        * **Value/Target:** The target URL provided by your hosting platform (e.g., `your-render-service.onrender.com`, `your-heroku-dns-target.herokudns.com`).
    * **For root domain (e.g., `yourdomain.com`):**
        * If your registrar supports `ALIAS`, `ANAME`, or `CNAME Flattening`, use that record type.
            * **Type:** `ALIAS` or `ANAME`
            * **Name/Host:** `@` (or leave blank, depending on registrar)
            * **Value/Target:** The target URL provided by your hosting platform.
        * If not, you might need to use URL forwarding/redirects (less ideal) or point an `A` record to an IP address provided by your host (check their specific instructions).
4.  **SSL/HTTPS:** Your hosting provider (Render, Heroku, AWS via Load Balancer/CloudFront) usually handles automatic SSL certificate provisioning for custom domains added through their interface. Ensure `FORCE_HTTPS=true` is set if your provider handles the redirection.
5.  **Wait for Propagation:** DNS changes can take time (minutes to hours) to take effect globally.
6.  **Update `SITE_URL`:** Update the `SITE_URL` environment variable in your deployment to reflect your new custom domain (e.g., `https://www.yourdomain.com`).

### Troubleshooting

* **Redis Connection Issues (`ECONNREFUSED`, `ETIMEDOUT`, `NOAUTH`):**
    * Verify `REDIS_URL` is correct (password, host, port).
    * Check firewall rules (especially on AWS) allow connections to port 6379 from your app server.
    * Test connectivity from your local machine or app console if possible: `redis-cli -u $REDIS_URL PING` (should return `PONG`).
* **Telegram Connection Failed:**
    * Double-check `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`.
    * Ensure `TELEGRAM_SESSION_STRING` is valid and not expired. You may need to regenerate it.
    * Check network connectivity from your deployment environment to Telegram's servers.
* **AI Processing Errors:**
    * Verify `OPENROUTER_API_KEYS` are correct and have credits/access.
    * Check the specified `OPENROUTER_MODELS` / `OPENROUTER_FALLBACK_MODELS` are valid and accessible.
    * Look at application logs for specific errors from the AI library.
* **Rate Limiting Errors (HTTP 429):**
    * Check if `GLOBAL_RATE_LIMIT` or `IP_RATE_LIMIT` are being exceeded. Look at logs for rate limit warnings.
    * Ensure `PROXY_TRUST_LEVEL` is set correctly for your deployment environment if behind proxies/load balancers.
* **Application Crashes (`server.js` exits):** Check logs for `uncaughtException` errors. Ensure all required environment variables are set (run `npm run prestart` locally to verify).
* **Frontend Issues (Articles/Prices not loading):**
    * Check browser's developer console (F12) for JavaScript errors or failed network requests (`/api/cached-articles`, `/api/cached-prices`).
    * Verify the backend is running and Redis contains data. Check backend logs for API errors.

### Maintenance

* **Daily:** Monitor logs for errors. Check Redis backup status (if configured).
* **Weekly:** Consider rotating API keys if your security policy requires it.
* **Monthly:** Regenerate `TELEGRAM_SESSION_STRING` as it might expire.
* **Regularly:** Update dependencies (`npm update`, `npm audit fix`) and test thoroughly. Check for security updates.

### License

MIT License. Refer to the `LICENSE` file for full terms.
