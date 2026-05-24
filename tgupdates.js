require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
const { NewMessage } = require('telegram/events');

// Отримуємо значення з .env
const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
const apiHash = process.env.TELEGRAM_API_HASH;
const phoneNumber = process.env.PHONE_NUMBER;
const storageDir = path.join(__dirname, 'storage');
const sessionFile = path.join(storageDir, 'session.dat');
const channelUsername = process.env.CHANNEL_USERNAME;  // Нікнейм каналу або ID

if (!apiId || !apiHash || !phoneNumber || !channelUsername) {
    console.error('Заповніть TELEGRAM_API_ID, TELEGRAM_API_HASH, PHONE_NUMBER і CHANNEL_USERNAME в .env');
    process.exit(1);
}

const folderPath = path.join(storageDir, channelUsername);
fs.mkdirSync(folderPath, { recursive: true });

function removeCircularReferences() {
    const seen = new Set();
    return function (key, value) {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return undefined; // Якщо посилання вже є, повертаємо undefined
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
    console.log("Сесія збережена в файл.");
}

const savedSession = loadSessionString();

function createClient(sessionString) {
    return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 5,
    });
}

let client = createClient(savedSession);

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

// Підключення до клієнта зі збереженою сесією
async function connectWithSavedSession() {
    try {
        console.log("Підключення до Telegram...");
        await client.connect();
        console.log("Клієнт підключено успішно.");

        const me = await client.getMe();
        console.log(`Логін: ${me.username}`);

        saveSession();
        return true;

    } catch (error) {
        console.error("Помилка при підключенні зі збереженою сесією:", error);

        try {
            await client.disconnect();
        } catch (_) {}

        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            console.error("Збережена сесія видалена. Потрібна повторна авторизація.");
        }

        return false;
    }
}

// Підписка на оновлення каналу
async function subscribeToChannel() {
    try {
        // Отримання об'єкта каналу
        const channel = await client.getEntity(channelUsername);
        console.log(`Підключено до каналу: ${channel.title}`);
        console.log(`ID каналу: ${channel.id}`);

        // Обробка нових повідомлень
        client.addEventHandler(async (event) => {
            const message = event.message;
            const timestamp = Math.floor(Date.now() / 1000);
            const filename = path.join(folderPath, `event_${timestamp}.json`);
            fs.writeFileSync(filename, JSON.stringify(event.message, removeCircularReferences(), 4), 'utf8');
            //console.log(`Автор: ${message.senderId}`);
            console.log(`Текст: ${message.text}`);
        }, new NewMessage({ chats: [channel.id] }));

    } catch (error) {
        console.error("Помилка під час підключення до каналу:", error);
    }
}

// Підтвердження коду для входу, якщо це перший запуск
async function signIn() {
    try {
        console.log("Отримання коду для входу...");
        await client.start({
            phoneNumber: phoneNumber,
            phoneCode: async () => {
                const code = await ask('Введіть код з Telegram: ');
                if (code === '') {
                    throw new Error("Код порожній");
                }

                return code;
            },
            password: async () => {
                const password = await ask('Введіть пароль 2FA: ');
                if (password === '') {
                    throw new Error("Пароль порожній");
                }

                return password;
            },
            onError: (error) => {
                console.error("Помилка під час авторизації:", error);
            }
        });

        console.log("Успішно увійшли!");
        const me = await client.getMe();
        console.log(`Логін: ${me.username}`);
        saveSession();
        return true;
    } catch (error) {
        console.error("Помилка при вході:", error);
        return false;
    }
}

// Перевірка чи вже є збережена сесія, і якщо ні - авторизація
async function checkSession() {
    let isReady = false;

    if (savedSession.length > 0) {
        console.log("Сесія знайдена. Підключаємо...");
        isReady = await connectWithSavedSession();
    } else {
        console.log("Сесія не знайдена. Виконуємо авторизацію...");
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
