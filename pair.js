const express = require('express');
const fs = require('fs-extra');
const { exec } = require("child_process");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const { upload } = require('./mega');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const router = express.Router();
const MESSAGE = process.env.MESSAGE || `\n*ᴅᴇᴀʀ ᴜsᴇʀ ᴛʜɪs ɪs ʏᴏᴜʀ sᴇssɪᴏɴ ɪᴅ*\n\n◕ ⚠️ *ᴘʟᴇᴀsᴇ ᴅᴏ ɴᴏᴛ sʜᴀʀᴇ ᴛʜɪs ᴄᴏᴅᴇ ᴡɪᴛʜ ᴀɴʏᴏɴᴇ ᴀs ɪᴛ ᴄᴏɴᴛᴀɪɴs ʀᴇǫᴜɪʀᴇᴅ ᴅᴀᴛᴀ ᴛᴏ ɢᴇᴛ ʏᴏᴜʀ ᴄᴏɴᴛᴀᴄᴛ ᴅᴇᴛᴀɪʟs ᴀɴᴅ ᴀᴄᴄᴇss ʏᴏᴜʀ ᴡʜᴀᴛsᴀᴘᴘ*`;

// Random browser options
const browserOptions = [
    Browsers.macOS("Safari"),
    Browsers.macOS("Desktop"),
    Browsers.macOS("Chrome"),
    Browsers.macOS("Firefox"),
    Browsers.macOS("Opera"),
];

function getRandomBrowser() {
    return browserOptions[Math.floor(Math.random() * browserOptions.length)];
}

// Generate a random Mega ID
function randomMegaId(length = 6, numberLength = 4) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const number = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${result}${number}`;
}

router.get('/', async (req, res) => {
    const num = req.query.number.replace(/[^0-9]/g, ''); // Sanitize input

    async function getPair() {
        const sessionPath = `./auth_info_baileys_${Date.now()}`;
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

        try {
            const session = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                browser: getRandomBrowser(),
            });

            if (!session.authState.creds.registered) {
                await delay(1500);
                const code = await session.requestPairingCode(num);
                if (!res.headersSent) {
                    res.send({ code });
                }
            }

            session.ev.on('creds.update', saveCreds);

            session.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    try {
                        await delay(10000);
                        const credsPath = `${sessionPath}/creds.json`;
                        if (fs.existsSync(credsPath)) {
                            const megaUrl = await upload(fs.createReadStream(credsPath), `${randomMegaId()}.json`);
                            const sessionId = megaUrl.replace('https://mega.nz/file/', '');

                            const message = await session.sendMessage(session.user.id, { text: `Rudhra~${sessionId}` });
                            await session.sendMessage(session.user.id, {
                                document: fs.readFileSync(credsPath),
                                fileName: 'creds.json',
                                mimetype: 'application/json',
                                caption: "Upload this file to `RUDHRA-BOT SESSION` creds.json folder",
                            });

                            await session.sendMessage(session.user.id, {
                                text: MESSAGE,
                                contextInfo: {
                                    externalAdReply: {
                                        title: "𝗥𝗨𝗗𝗛𝗥𝗔 𝗦𝗘𝗦𝗦𝗜𝗢𝗡 𝗜𝗗",
                                        body: "ʀᴜᴅʜʀᴀ ʙᴏᴛ",
                                        thumbnailUrl: "https://i.imgur.com/Zim2VKH.jpeg",
                                        sourceUrl: "https://github.com/princerudh/rudhra-bot",
                                    },
                                },
                            }, { quoted: message });
                        }
                    } catch (e) {
                        console.error("Error during session handling: ", e);
                    } finally {
                        fs.removeSync(sessionPath); // Cleanup
                    }
                }

                if (connection === "close") {
                    const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                    switch (reason) {
                        case DisconnectReason.connectionClosed:
                            console.log("Connection closed!");
                            break;
                        case DisconnectReason.connectionLost:
                            console.log("Connection lost from server!");
                            break;
                        case DisconnectReason.restartRequired:
                            console.log("Restart required. Restarting...");
                            await getPair();
                            break;
                        case DisconnectReason.timedOut:
                            console.log("Connection timed out!");
                            break;
                        default:
                            console.log("Connection closed with error. Restarting...");
                            exec('pm2 restart rudhra');
                    }
                }
            });

        } catch (err) {
            console.error("Error in getPair function: ", err);
            if (!res.headersSent) {
                res.send({ code: "Try again after a few minutes." });
            }
            exec('pm2 restart rudhra');
        } finally {
            fs.removeSync(sessionPath); // Ensure cleanup
        }
    }

    await getPair();
});

module.exports = router;
