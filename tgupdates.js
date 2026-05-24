if (typeof globalThis.crypto === 'undefined') {
    globalThis.crypto = require('crypto');
}
require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
const { NewMessage } = require('telegram/events');

// Read values from .env
const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
const apiHash = process.env.TELEGRAM_API_HASH?.trim();
const phoneNumber = process.env.PHONE_NUMBER?.trim();
const storageDir = path.join(__dirname, 'storage');
const sessionFile = path.join(storageDir, 'session.dat');
const channelUsername = process.env.CHANNEL_USERNAME?.trim();  // Channel username or ID

if (!apiId || !apiHash || !phoneNumber || !channelUsername) {
    console.error('Set TELEGRAM_API_ID, TELEGRAM_API_HASH, PHONE_NUMBER, and CHANNEL_USERNAME in .env');
    process.exit(1);
}

const folderPath = path.join(storageDir, channelUsername);
fs.mkdirSync(folderPath, { recursive: true });

function removeCircularReferences() {
    const seen = new Set();
    return function (key, value) {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return undefined; // Skip values that were already serialized.
            }
            seen.add(value);
        }
        return value;
    };
}

function loadSessionString() {
    if (!fs.existsSync(sessionFile)) {
        return '';
    }

    return fs.readFileSync(sessionFile, 'utf8').trim();
}

function saveSession() {
    fs.writeFileSync(sessionFile, client.session.save(), 'utf8');
    console.log("Session saved to file.");
}

const savedSession = loadSessionString();

function createClient(sessionString) {
    return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 5,
    });
}

let client;

async function ask(question) {
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        readline.question(question, (answer) => {
            readline.close();
            resolve(answer.trim());
        });
    });
}

// Connect using a saved session.
async function connectWithSavedSession() {
    try {
        console.log("Connecting to Telegram...");
        await client.connect();
        console.log("Client connected successfully.");

        const me = await client.getMe();
        console.log(`Username: ${me.username}`);

        saveSession();
        return true;

    } catch (error) {
        console.error("Error connecting with the saved session:", error);

        try {
            await client.disconnect();
        } catch (_) {}

        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            console.error("Saved session was removed. Reauthorization is required.");
        }

        return false;
    }
}

// Subscribe to channel updates.
async function subscribeToChannel() {
    try {
        // Get the channel entity.
        const channel = await client.getEntity(channelUsername);
        console.log(`Connected to channel: ${channel.title}`);
        console.log(`Channel ID: ${channel.id}`);

        // Handle new messages.
        client.addEventHandler(async (event) => {
            const message = event.message;
            const timestamp = Math.floor(Date.now() / 1000);
            const filename = path.join(folderPath, `event_${timestamp}.json`);
            fs.writeFileSync(filename, JSON.stringify(event.message, removeCircularReferences(), 4), 'utf8');
            //console.log(`Author: ${message.senderId}`);
            console.log(`Text: ${message.text}`);
        }, new NewMessage({ chats: [channel.id] }));

    } catch (error) {
        console.error("Error while connecting to the channel:", error);
    }
}

// Confirm the login code on the first run.
async function signIn() {
    try {
        console.log("Getting login code...");
        console.log("[AUTH] Calling client.start()...");
        await client.start({
            phoneNumber: phoneNumber,
            phoneCode: async (isCodeViaApp) => {
                console.log(`[AUTH] phoneCode callback called, isCodeViaApp=${isCodeViaApp}`);
                const via = isCodeViaApp ? 'Telegram app' : 'SMS';
                const code = await ask(`Enter the Telegram code (check your ${via}): `);
                if (code === '') {
                    throw new Error("Code is empty");
                }

                return code;
            },
            password: async () => {
                const password = await ask('Enter the 2FA password: ');
                if (password === '') {
                    throw new Error("Password is empty");
                }

                return password;
            },
            onError: (error) => {
                console.error("Authorization error:", error);
            }
        });

        console.log("Signed in successfully!");
        const me = await client.getMe();
        console.log(`Username: ${me.username}`);
        saveSession();
        return true;
    } catch (error) {
        console.error("Sign-in error:", error);
        return false;
    }
}

// Check for a saved session; authorize if none exists.
async function checkSession() {
    let isReady = false;

    if (savedSession.length > 0) {
        console.log("Session found. Connecting...");
        client = createClient(savedSession);
        isReady = await connectWithSavedSession();
    } else {
        console.log("Session not found. Starting authorization...");
    }

    if (!isReady) {
        client = createClient('');
        isReady = await signIn();
    }

    if (!isReady) {
        process.exitCode = 1;
        return;
    }

    await subscribeToChannel();
}

checkSession();
