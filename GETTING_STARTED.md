# Getting Started with Crypto AI News Processor

Welcome! This guide provides detailed, step-by-step instructions to help you set up, configure, and run the Crypto AI News Processor application. We'll try to explain technical terms as we go.

---

## 1. What You'll Need (Prerequisites)

Before we dive into the setup, you need to have a few tools and accounts ready. Think of these as the ingredients and equipment for our project.

### Software to Install on Your Computer

* **Node.js (and npm): The Application's Engine**
    * **What it is:** Node.js is a program that allows your computer to run applications written in JavaScript (which this project is). When you install Node.js, it also comes with `npm` (Node Package Manager), a tool that helps you download and manage the code libraries our project needs.
    * **Why you need it:** Without Node.js, your computer won't understand how to run the Crypto AI News Processor.
    * **Recommendation:** Version 18.x LTS (Long Term Support) or newer. "LTS" versions are generally more stable.
    * **How to get it:**
        1.  Go to the official Node.js website: [nodejs.org](https://nodejs.org/)
        2.  On the homepage, you should see download options. Choose the one labeled **"LTS"**.
        3.  Download the installer for your operating system (Windows, macOS, etc.).
        4.  Run the installer you downloaded. Follow the on-screen instructions. Usually, accepting the default settings is fine.
    * **How to check if it's installed:**
        1.  Open your computer's **Terminal** (on macOS or Linux) or **Command Prompt/PowerShell** (on Windows).
            * *To open Terminal/Command Prompt:*
                * **Windows:** Press the Windows key, type `cmd` (for Command Prompt) or `powershell`, and press Enter.
                * **macOS:** Press Command + Spacebar to open Spotlight search, type `Terminal`, and press Enter.
        2.  In the window that appears, type exactly:
            ```bash
            node -v
            ```
        3.  Press Enter. If Node.js is installed correctly, you'll see a version number like `v18.19.0`.
        4.  Next, type:
            ```bash
            npm -v
            ```
        5.  Press Enter. You should see another version number.

* **Git: The Code Manager**
    * **What it is:** Git is a version control system. It's a tool developers use to track changes in code and to download code from online platforms like GitHub (where this project is likely hosted).
    * **Why you need it:** You'll use Git to easily download ("clone") the project's source code to your computer.
    * **How to get it:**
        1.  Go to the official Git website: [git-scm.com/downloads](https://git-scm.com/downloads)
        2.  Download the installer for your operating system.
        3.  Run the installer. For most users, the default settings during installation are suitable.
    * **How to check if it's installed:**
        1.  Open your Terminal or Command Prompt.
        2.  Type:
            ```bash
            git --version
            ```
        3.  Press Enter. If Git is installed, you'll see a version number like `git version 2.40.0`.
    * **(Alternative if you don't want to install Git):** Most GitHub project pages have a green "Code" button. Clicking this usually gives an option to "Download ZIP". You can download the code this way and then unzip the file to a folder on your computer. However, using Git is recommended for easier updates.

### Services & Accounts to Set Up Online

* **Redis Instance: The Fast Memory Cache**
    * **What it is:** Redis is a very fast, in-memory data store. Our application uses it as a temporary "cache" to store the news articles and cryptocurrency prices it has processed. This makes retrieving them for the webpage or API very quick.
    * **Why you need it:** It helps the application perform efficiently.
    * **Cloud Options (Recommended for ease of use, often have free tiers):**
        * **Render Redis:** If you plan to deploy your application on Render (see Section 5), they offer a managed Redis service. You can create a free Redis instance directly on their platform.
        * **Redis Cloud (from Redis Inc.):** Visit [redis.com/try-free/](https://redis.com/try-free/). They offer a free tier that's suitable for this project. You'll need to sign up and create a new database.
    * **Local Option (More advanced):** You *can* install and run Redis directly on your computer (e.g., using Docker or by downloading it from [redis.io/download](https://redis.io/download)). This is more complex and generally not recommended if you're new to this.
    * **What you need to get:** After setting up your Redis instance (wherever you choose), you will need its **Connection URL**. This URL tells our application how to find and connect to your Redis database. It typically looks something like this: `redis://:your_password@your_hostname_or_ip:your_port_number`. Make a note of this URL; you'll need it for the configuration file.

* **Telegram Account & API Credentials: Your Key to Telegram**
    * **What it is:** To read messages from a Telegram channel, our application needs permission. These credentials act like a special key that you grant to the application.
    * **Why you need it:** To allow the application to connect to Telegram and fetch messages from the channel you specify.
    * **How to get them:**
        1.  Go to the official Telegram Core website: [my.telegram.org/apps](https://my.telegram.org/apps).
        2.  Log in with your existing Telegram account (the one you'll use to authorize the app).
        3.  You'll see a form titled "API development tools" or similar.
        4.  Fill in the "App title" (e.g., "MyCryptoNewsProcessor") and "Short name" (e.g., "mycryptonews"). The other fields can usually be left blank or with default values. Click "Create application".
        5.  After the application is created, you will be shown your **`api_id`** (a number) and **`api_hash`** (a long string of characters).
        6.  **Very Important:** Copy both the `api_id` and `api_hash` and save them somewhere safe. These are sensitive credentials, like a password. You will need them for the configuration file.

* **OpenRouter API Key: Your Key to the AI Brain**
    * **What it is:** OpenRouter is a service that gives you access to many different AI models through a single API key. Our application uses these AI models to understand the Telegram messages and write the news summaries.
    * **Why you need it:** To enable the AI-powered content generation.
    * **How to get it:**
        1.  Go to the OpenRouter website: [openrouter.ai/keys](https://openrouter.ai/keys).
        2.  You'll need to sign up for an account if you don't have one. They usually offer some free credits to start.
        3.  Once logged in, find the section to create API keys.
        4.  Click "Create Key" or a similar button. You might be asked to give it a name (e.g., "CryptoProcessorKey").
        5.  OpenRouter will generate an API key for you. It will look like a long string of characters (e.g., `sk-or-v1-abc...xyz`).
        6.  **Very Important:** Copy this API key and save it somewhere safe. This is also a sensitive credential. You will need it for the configuration file.

---

## 2. Setting Up the Project on Your Computer

Now that you have the prerequisites, let's get the project code onto your computer and prepare it.

1.  **Choose a Location for the Project:**
    Decide where on your computer you want to store the project files (e.g., in your `Documents` folder, or a dedicated `Projects` folder).

2.  **Open Your Terminal or Command Prompt:**
    Refer back to the "Node.js" section if you need a reminder on how to open this.

3.  **Navigate to Your Chosen Location:**
    Use the `cd` (change directory) command. For example, if you want to put it in `Documents`:
    ```bash
    cd Documents
    ```
    Press Enter.

4.  **Clone the Project Repository (Download the Code):**
    * **What it is:** "Cloning" uses Git to make a complete copy of the project's code from its online home (usually GitHub) to your computer.
    * You'll need the project's repository URL. This is the web address of the project on GitHub, usually ending in `.git`.
    * In your terminal, type:
        ```bash
        git clone <repository_url>
        ```
        (Replace `<repository_url>` with the actual URL of this project's repository.)
        Press Enter. Git will download all the files into a new folder.
    * **(If you downloaded a ZIP instead of using Git):** Unzip the downloaded file into your chosen location. The folder created will be your project folder.

5.  **Navigate into the Project Folder:**
    Once cloning (or unzipping) is complete, a new folder will have been created (e.g., `crypto-ai-news-processor`).
    In your terminal, type `cd` followed by the name of that folder:
    ```bash
    cd crypto-ai-news-processor
    ```
    (Adjust the folder name if it's different.) Press Enter. Your terminal prompt should change, indicating you are now "inside" that folder.

6.  **Install Project Dependencies (Get the Code Libraries):**
    * **What it is:** This project uses several pre-built code libraries (called "packages" or "dependencies") to perform various tasks (e.g., running the web server, talking to Redis, connecting to Telegram). The `package.json` file in the project lists all these necessary libraries. The `npm install` command reads this list and downloads and installs them into a `node_modules` folder within your project.
    * Make sure you are still inside the project folder in your terminal. Type:
        ```bash
        npm install
        ```
        Press Enter. This might take a few minutes as `npm` downloads and installs everything. You'll see some text scrolling; this is normal. This also installs `input`, a tool needed for the Telegram session generation script, as a "development dependency."

---

## 3. Configuring the Application (`.env` File)

This is a very important step. The application needs to know your specific API keys, database URLs, and other settings to work correctly. You'll provide these in a special configuration file named `.env`.

1.  **Understand the `.env` File:**
    * The `.env` file is used to store environment-specific variables – settings that might be different for you than for someone else, or different when you're testing on your computer versus running it live on a server.
    * Crucially, it's where you put your **secret API keys and passwords**. This file is *not* typically shared or committed to Git, to keep your secrets safe.
    * The project includes a template file named `.env.example`. You will copy this template and fill it with your actual values.

2.  **Create Your `.env` File:**
    * In your terminal (ensure you are still in the project's root folder), type the following command to copy the example file:
        * On macOS or Linux:
            ```bash
            cp .env.example .env
            ```
        * On Windows (Command Prompt):
            ```bash
            copy .env.example .env
            ```
        Press Enter. This creates a new file named `.env` which is a copy of `.env.example`.

3.  **Edit Your `.env` File:**
    * Open the newly created `.env` file with a plain text editor (e.g., Notepad on Windows, TextEdit on macOS, or more advanced editors like VS Code, Sublime Text, Atom).
    * You will see a list of settings, each on a new line, in the format `VARIABLE_NAME=value`. Many lines will have comments (starting with `#`) explaining what each variable is for.
    * **Carefully replace the placeholder values (or empty values after `=`) with your actual information that you gathered in the "Prerequisites" step.**

    **Key Variables to Fill In:**
    * `TELEGRAM_API_ID=YOUR_TELEGRAM_API_ID_HERE`
    * `TELEGRAM_API_HASH=YOUR_TELEGRAM_API_HASH_HERE`
    * `OPENROUTER_API_KEYS=YOUR_OPENROUTER_API_KEY_HERE` (If you have multiple OpenRouter keys, separate them with a comma, no spaces: `key1,key2`)
    * `REDIS_URL=YOUR_REDIS_CONNECTION_URL_HERE` (e.g., `redis://:yourpassword@host.com:6379`)
    * `TELEGRAM_CHANNEL=THE_TELEGRAM_CHANNEL_TO_MONITOR` (e.g., `@somepublicchannel` or a private channel ID like `-1001234567890`)
    * `SITE_URL=http://localhost:3000` (For local testing. If you deploy it online, change this to its public web address, e.g., `https://your-app-name.onrender.com`)

    **Other Important Variables (Defaults are often okay to start):**
    * `CRYPTO_SYMBOLS`: A comma-separated list of cryptocurrencies you want to track prices for. The format is `SYMBOL:CoinGeckoID` (e.g., `BTC:bitcoin,ETH:ethereum`). You can find CoinGecko IDs on their website.
    * `OPENROUTER_MODELS`: A comma-separated list of AI models from OpenRouter you want the application to try, in order of preference.
    * Review the comments for other variables in the `.env.example` file to understand what they do.

    **Important:**
    * Do not use quotes around the values unless the value itself contains spaces or special characters (which is rare for these types of settings).
    * Make sure there are no extra spaces around the `=` sign or at the beginning/end of the values.
    * Save the `.env` file after making your changes.

4.  **Generate Your Telegram Session String:**
    * **What it is:** Even with the API ID and Hash, the application needs to perform an initial login to your Telegram account. This login process generates a "session string" – a long piece of text that the application can then use for future connections without needing your password or login codes every time.
    * **How to do it:**
        1.  Ensure you have correctly filled in `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` in your saved `.env` file.
        2.  Go back to your terminal (still in the project's root folder).
        3.  Type the following command:
            ```bash
            npm run generate-session
            ```
            Press Enter. This runs a special script included in the project (`src/generate-session.js`).
        4.  The script will start and prompt you for information:
            * `Enter your phone number (with country code, e.g., +1234567890):` Type your Telegram phone number and press Enter.
            * `Enter your 2FA password (if set, otherwise press Enter):` If you have Two-Factor Authentication enabled on Telegram, enter your password. If not, just press Enter.
            * `Enter the code you received via Telegram/SMS:` Telegram will send a login code to your Telegram app (or sometimes via SMS). Enter this code and press Enter.
        5.  If the login is successful, the script will print a message like "Login successful!" followed by:
            ```
            🔒 Your session string is (KEEP THIS SECRET!):

            (A VERY LONG STRING OF CHARACTERS WILL APPEAR HERE)

            ℹ️ Copy this *entire* string and paste it into your .env file as TELEGRAM_SESSION_STRING.
            ```
        6.  **Carefully select and copy the entire session string.** It can be very long.
        7.  Open your `.env` file again with your text editor.
        8.  Find the line that says `TELEGRAM_SESSION_STRING=`.
        9.  Paste the copied session string immediately after the `=` sign.
            ```dotenv
            TELEGRAM_SESSION_STRING=PASTE_THE_VERY_LONG_STRING_YOU_COPIED_HERE
            ```
        10. Save the `.env` file.

---

## 4. Running the Application

You've done the hard parts! Now let's start the application.

1.  **Start the Server:**
    * In your terminal (still in the project's root folder), type:
        ```bash
        npm start
        ```
        Press Enter.
    * **What happens:** This command tells `npm` to run the "start" script defined in the `package.json` file. This script typically runs `node server.js`, which is the main entry point of our application.
    * You should see a series of log messages appearing in your terminal. These messages tell you what the application is doing:
        * Validating environment variables.
        * Connecting to Redis.
        * Initializing and starting the Telegram polling service.
        * Starting the price polling service.
        * If everything goes well, you'll see a message like:
            `🚀 Server is running on http://localhost:3000` (or whatever port is configured).
            `✅ Application startup complete.`

2.  **Development Mode (Optional, for developers):**
    * If you plan to make changes to the code and want the server to automatically restart when you save a file, you can run it in development mode:
        ```bash
        npm run dev
        ```
        This uses a tool called `nodemon`.

3.  **Accessing the Web Frontend:**
    * Once the server is running (you see the "Server is running" message), open your preferred web browser (like Chrome, Firefox, Edge, or Safari).
    * In the address bar, type the URL shown in the terminal, which is usually:
        `http://localhost:3000` (if you're running it on your own computer and haven't changed the default `PORT` in `.env`).
    * Press Enter.
    * You should see the "Crypto AI News Processor" webpage.
    * **Be Patient:** When you first start the application, it needs to fetch messages from Telegram, send them to the AI for processing, and get the results back. This can take a few minutes. You might see "Loading articles..." or "Loading prices..." initially. Give it some time to populate.

---

## 5. Deploying the Application (Making it Live Online)

Running the application on your own computer (`localhost`) is great for setup and testing. However, if you want it to run 24/7 and be accessible from anywhere on the internet, you need to "deploy" it to a web hosting service.

**Render.com** is a platform that is generally friendly for deploying Node.js applications like this one and offers a free tier for web services and Redis.

**General Steps for Deploying on a Platform like Render:**

1.  **Prepare Your Code for Git:**
    * Make sure all your project code is saved.
    * **Crucially, ensure your `.env` file is NOT committed to Git.** The `.env.example` file *should* be committed, but your actual `.env` with secrets must stay private. Your hosting platform will have its own way to manage secret environment variables.

2.  **Push Your Code to a Git Repository (e.g., GitHub):**
    * If you haven't already, create a repository on a service like GitHub, GitLab, or Bitbucket.
    * Follow the instructions from that service to push your local project code (again, without the `.env` file) to the online repository.

3.  **Sign Up/Log In to Your Hosting Platform (e.g., Render.com):**
    Create an account or log in.

4.  **Create a Redis Instance on the Platform:**
    * Most platforms that support Redis will have an option to create a new Redis database or "addon."
    * Choose a plan (a free tier is usually sufficient for this project to start).
    * Once created, find its **Connection URL**. You will need this for the environment variables on the platform.

5.  **Create a New "Web Service" (or "App") on the Platform:**
    * There will be an option to create a new service.
    * Connect it to your Git repository (from step 2). The platform will usually detect it's a Node.js project.
    * **Build Command:** Set this to `npm install`. This tells the platform how to install your project's dependencies.
    * **Start Command:** Set this to `npm start`. This tells the platform how to run your application after it's built.

6.  **Configure Environment Variables on the Platform:**
    * This is the most critical step for deployment. Your hosting platform will have a section in your service's settings for "Environment Variables" or "Config Vars."
    * You need to **manually add each variable** from your local `.env` file here.
        * For `REDIS_URL`, use the connection URL of the Redis instance you created on the platform (from step 4).
        * For `SITE_URL`, use the public web address that the platform assigns to your deployed application (e.g., `https://your-app-name.onrender.com`).
        * Set `NODE_ENV` to `production`.
        * Ensure `DO_FLUSH_REDIS` is set to `false` (unless you specifically want to clear the Redis cache during this particular deployment, which is rare).
        * Add all your other API keys and settings (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_STRING`, `OPENROUTER_API_KEYS`, etc.).

7.  **Deploy:**
    * Start the deployment process. The platform will pull your code from Git, run the build command (`npm install`), and then run the start command (`npm start`) using the environment variables you configured.
    * Monitor the deployment logs provided by the platform for any errors.

---

## 6. Troubleshooting Common Issues

If you run into problems, here are some common things to check:

* **Application Fails to Start (Error in Terminal/Logs):**
    * **Check Logs Carefully:** The error message in your terminal (or in the deployment logs on your hosting platform) is the most important clue. Read it closely.
    * **Missing Environment Variables:** This is very common. Double-check that *every* required variable in your `.env` file (for local) or in your hosting platform's settings (for deployment) is present and correctly spelled.
    * **Incorrect `.env` Syntax:** Ensure your `.env` file has `VARIABLE_NAME=value` on each line, with no extra spaces or quotes unless necessary.
    * **Redis Connection Issues:**
        * Is your Redis server running (if local)?
        * Is the `REDIS_URL` in your `.env` file (or platform settings) exactly correct (including password, host, port)?
        * If using a cloud Redis, check if there are any network restrictions or if the service is down.
    * **Port Conflict:** If running locally and you see an error like "EADDRINUSE" or "port already in use," it means another application is already using the port number (e.g., 3000) that this app is trying to use. You can either stop the other application or change the `PORT` variable in your `.env` file to a different number (e.g., `3001`).

* **No Telegram Messages Are Processed:**
    * **API Credentials:** Triple-check your `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` in `.env`.
    * **Session String:** Your `TELEGRAM_SESSION_STRING` might be invalid, expired, or incorrectly copied. Try running `npm run generate-session` again and carefully re-paste the *entire* new string into your `.env` file.
    * **Channel Name/ID:** Ensure `TELEGRAM_CHANNEL` in `.env` is the correct public username (e.g., `@channelname`) or private channel ID (a negative number like `-100xxxxxxxxxx`). The bot must be a member of the channel if it's private.
    * **Channel Activity:** Is there recent activity in the Telegram channel you're monitoring?
    * **Telegram Rate Limits:** Very rarely, Telegram might temporarily limit access if the app makes too many requests too quickly (though the app is designed to be polite).

* **No AI Articles Are Generated (or AI Errors in Logs):**
    * **OpenRouter API Key:** Verify your `OPENROUTER_API_KEYS` in `.env`. Is it correct? Does your OpenRouter account have credits or is it active?
    * **Models:** Ensure the models listed in `OPENROUTER_MODELS` are valid and available on OpenRouter.
    * **AI Prompt Issues:** While unlikely if you haven't changed the core code, issues with the prompt sent to the AI could cause problems. Check application logs for details.
    * **Network Issues:** Your server might be having trouble reaching OpenRouter's API.

* **Frontend Webpage Issues (e.g., Stuck on "Loading...", No Data):**
    * **Browser Developer Console:** This is your best friend for frontend issues.
        * *How to open:* In most browsers (Chrome, Firefox, Edge), press the **F12** key. Or, right-click on the webpage and select "Inspect" or "Inspect Element," then look for a "Console" tab.
        * Look for any error messages shown in red. These often point to JavaScript problems or failed network requests.
    * **API Not Running:** Is the backend server (the `npm start` process) actually running and accessible?
    * **CORS Errors:** If the `SITE_URL` in your `.env` file (or platform settings) doesn't exactly match the URL you are using to access the frontend, you might get Cross-Origin Resource Sharing (CORS) errors in the browser console. This means the browser is blocking the frontend from getting data from the backend for security reasons. Ensure `SITE_URL` is correct.
    * **API Errors:** Check the browser's "Network" tab (also in the developer tools) to see if requests to `/api/cached-articles` or `/api/cached-prices` are failing or returning errors.

This guide should help you get the Crypto AI News Processor up and running. If you encounter specific error messages not covered here, searching for those messages online can often lead to solutions. Good luck!
