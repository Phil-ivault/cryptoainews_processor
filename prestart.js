import dotenv from 'dotenv';
dotenv.config();

if (process.env.DO_FLUSH_REDIS === 'true') {
    console.warn('🚨 DO_FLUSH_REDIS is enabled - Redis will be wiped on next deploy');
}

const required = ['OPENROUTER_API_KEYS', 'TELEGRAM_API_ID', 'TELEGRAM_API_HASH'];
required.forEach(varName => {
    if (!process.env[varName]) {
        throw new Error(`Missing ${varName} in .env file`);
    }
});