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
const sessionFile = 'storage/session.dat';
const channelUsername = process.env.CHANNEL_USERNAME;  // Нікнейм каналу або ID

const folderPath = path.join(__dirname, 'storage/' + channelUsername);
if (!fs.existsSync(folderPath)) fs.mkdir(folderPath, (err) => {
    if (err) {
        console.error('Error creating folder:', err);
    } else {
        console.log('Folder created successfully at', folderPath);
    }
});

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

// Перевірка на існування збереженої сесії
let stringSession = new StringSession('');
if (fs.existsSync(sessionFile)) {
    stringSession = new StringSession(fs.readFileSync(sessionFile, 'utf8'));
}

// Створення TelegramClient
const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

// Підключення до клієнта
async function initializeClient() {
    try {
        // Підключаємо клієнт
        console.log("Підключення до Telegram...");
        await client.connect();
        console.log("Клієнт підключено успішно.");

        // Перевірка на наявність client.connection
        if (client.connection && client.connection.dcId) {
            const dc = client.connection.dcId;
            console.log("Data Center ID:", dc);
        } else {
            console.error("Client connection or dcId is not available.");
        }

        // Отримання користувача
        const me = await client.getMe();
        console.log(`Логін: ${me.username}`);

        // Підписка на оновлення каналу
        await subscribeToChannel();

        // Збереження сесії в файл після успішного підключення
        fs.writeFileSync(sessionFile, client.session.save(), 'utf8');
        console.log("Сесія збережена в файл.");

    } catch (error) {
        console.error("Помилка при підключенні:", error);
        if (error instanceof Error) {
            // Спробуємо отримати деталі помилки
            console.error("Error details:", error.stack);
        }
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
            const filename = `storage/${channelUsername}/event_${timestamp}.json`;
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
        // Оновлений метод для авторизації з phoneCode
        console.log("Отримання коду для входу...");
        await client.start({
            phoneNumber: phoneNumber,
            phoneCode: async () => {
                const readline = require('readline').createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                return new Promise((resolve, reject) => {
                    readline.question('Введіть код з SMS: ', (code) => {
                        if (code.trim() === '') {
                            console.error("Код не може бути порожнім!");
                            readline.close();
                            reject(new Error("Код порожній"));
                            return;
                        }
                        console.log(`Введений код: ${code}`);
                        readline.close();
                        resolve(code);
                    });
                });
            },
            onError: (error) => {
                console.error("Помилка під час авторизації:", error);
            }
        });

        console.log("Успішно увійшли!");
        await initializeClient();
    } catch (error) {
        console.error("Помилка при вході:", error);
    }
}

// Перевірка чи вже є збережена сесія, і якщо ні - авторизація
async function checkSession() {
    if (stringSession.session) {
        console.log("Сесія знайдена. Підключаємо...");
        await initializeClient();
    } else {
        console.log("Сесія не знайдена. Виконуємо авторизацію...");
        await signIn();
    }
}

checkSession();
