import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input'; // ES Module import
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Interactively generates a Telegram session string.
 */
async function generateSession() {
    console.log("--- Telegram Session String Generator ---");
    console.log("This script will help you log in to Telegram and get your session string.");
    console.log("You MUST have TELEGRAM_API_ID and TELEGRAM_API_HASH set in your .env file first.\n");

    // Ensure API ID and Hash are present
    const apiIdStr = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;

    if (!apiIdStr || !apiHash) {
        console.error("💥 Error: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in your .env file.");
        console.error("Please create a .env file (copy .env.example) and fill them in.");
        return; // Exit if variables are missing
    }

    const apiId = Number(apiIdStr);

    // Start with an empty session string
    const stringSession = new StringSession("");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    try {
        await client.start({
            // Prompt user for login details using the 'input' package
            phoneNumber: async () => await input.text("Enter your phone number (with country code, e.g., +1234567890): "),
            password: async () => await input.text("Enter your 2FA password (if set, otherwise press Enter): "),
            phoneCode: async () => await input.text("Enter the code you received via Telegram/SMS: "),
            onError: (err) => console.error("Login Error:", err), // Log errors during login
        });

        console.log("\n✅ Login successful! You are now connected.");
        console.log("🔒 Your session string is (KEEP THIS SECRET!):");
        // Output the generated session string
        console.log(`\n${client.session.save()}\n`);
        console.log("ℹ️ Copy this *entire* string and paste it into your .env file as TELEGRAM_SESSION_STRING.");

    } catch (error) {
        console.error("💥 An unexpected error occurred:", error);
    } finally {
        // Always ensure the client disconnects
        if (client.connected) {
            await client.disconnect();
            console.log("\n🔌 Disconnected from Telegram.");
        }
    }
}

// Run the generation function
generateSession().catch(console.error);