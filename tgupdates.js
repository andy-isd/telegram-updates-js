if (typeof crypto === 'undefined') {
    const nodeCrypto = require('crypto');
    global.crypto = nodeCrypto.webcrypto || nodeCrypto;
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
const channelUsernames = process.env.CHANNEL_USERNAME?.split(',').map(s => s.trim()).filter(Boolean);

if (!apiId || !apiHash || !phoneNumber || !channelUsernames?.length) {
    console.error('Set TELEGRAM_API_ID, TELEGRAM_API_HASH, PHONE_NUMBER, and CHANNEL_USERNAME in .env');
    process.exit(1);
}

fs.mkdirSync(storageDir, { recursive: true });

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

async function resolveChannels() {
    const channelMap = new Map(); // channelId string -> { username, folderPath }

    for (const username of channelUsernames) {
        try {
            const channel = await client.getEntity(username);
            // Fetch latest message to initialize this channel's PTS in gramJS update state.
            // Without this, gramJS may not track the channel and miss incoming updates.
            await client.getMessages(channel, { limit: 1 });

            const folderPath = path.join(storageDir, username);
            fs.mkdirSync(folderPath, { recursive: true });
            channelMap.set(channel.id.toString(), { username, folderPath });

            console.log(`Connected to channel: ${channel.title} (${channel.id})`);
        } catch (error) {
            console.error(`Error connecting to channel "${username}":`, error);
        }
    }

    return channelMap;
}

function extractFields(message) {
    return {
        id: message.id,
        date: message.date,
        text: message.message ?? null,
        editDate: message.editDate ?? null,
        replyToMsgId: message.replyTo?.replyToMsgId ?? null,
        hasMedia: !!message.media,
        mediaType: message.media?.className ?? null,
        views: message.views ?? null,
        forwards: message.forwards ?? null,
    };
}

function saveMessage(info, message) {
    const filename = path.join(info.folderPath, `event_${message.id}.json`);
    if (fs.existsSync(filename)) return;
    fs.writeFileSync(filename, JSON.stringify(extractFields(message), null, 4), 'utf8');
    console.log(`[${info.username}] ${message.editDate ? 'edit' : 'new'} ${message.id}`);
}

function startListening(channelMap) {
    client.addEventHandler(async (event) => {
        const message = event.message;
        const rawId = (message?.peerId?.channelId ?? message?.peerId?.chatId)?.toString();
        if (!rawId) return;

        const info = channelMap.get(rawId);
        if (!info) return;

        saveMessage(info, message);
    }, new NewMessage({}));
}

async function startPolling(channelMap) {
    const lastIds = new Map();

    for (const [, info] of channelMap) {
        try {
            const msgs = await client.getMessages(info.username, { limit: 1 });
            lastIds.set(info.username, msgs?.[0]?.id ?? 0);
        } catch (e) {
            lastIds.set(info.username, 0);
        }
    }

    const INTERVAL = 11_000;
    const POLL_LIMIT = Math.round(INTERVAL / 1000) * 2;

    setInterval(async () => {
        await Promise.all([...channelMap.values()].map(async (info) => {
            try {
                const minId = lastIds.get(info.username) ?? 0;
                const msgs = await client.getMessages(info.username, { limit: POLL_LIMIT, minId });
                for (const msg of msgs) {
                    saveMessage(info, msg);
                    if (msg.id > (lastIds.get(info.username) ?? 0)) {
                        lastIds.set(info.username, msg.id);
                    }
                }
            } catch (e) {
                console.error(`[poll] ${info.username}:`, e.message);
            }
        }));
    }, INTERVAL);

    console.log(`Polling ${channelMap.size} channel(s) every ${INTERVAL / 1000}s.`);
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
        if (error.errorMessage === 'FLOOD' && error.seconds) {
            const minutes = Math.ceil(error.seconds / 60);
            console.error(`\nTelegram rate limit hit. Too many login attempts.`);
            console.error(`Wait ${error.seconds} seconds (≈${minutes} min) before trying again.\n`);
        } else {
            console.error("Sign-in error:", error);
        }
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

    // Load all dialog states so gramJS tracks PTS for every subscribed channel.
    try {
        await client.getDialogs({ limit: 100 });
        console.log('Dialogs loaded.');
    } catch (e) {
        console.warn('getDialogs failed (non-fatal):', e.message);
    }

    const channelMap = await resolveChannels();
    console.log(`Listening on ${channelMap.size} channel(s).`);
    startListening(channelMap);
    await startPolling(channelMap);
}

checkSession();
