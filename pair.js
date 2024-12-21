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

// Define browser options
const browserOptions = [
    Browsers.macOS("Safari"),
    Browsers.macOS("Desktop"),
    Browsers.macOS("Chrome"),
    Browsers.macOS("Firefox"),
    Browsers.macOS("Opera"),
];

// Pick a random browser configuration
function getRandomBrowser() {
    return browserOptions[Math.floor(Math.random() * browserOptions.length)];
}

// Clear the auth directory on startup
if (fs.existsSync('./auth_info_baileys')) {
    fs.emptyDirSync(__dirname + '/auth_info_baileys');
}

// Define the route
router.get('/', async (req, res) => {
    let num = req.query.number;

    async function getPair() {
        const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_baileys`);

        try {
            const session = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: getRandomBrowser(),
            });

            if (!session.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await session.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            session.ev.on('creds.update', saveCreds);

            session.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        await delay(10000);

                        if (fs.existsSync('./auth_info_baileys/creds.json')) {
                            const authPath = './auth_info_baileys/';
                            const user = session.user.id;

                            function randomMegaId(length = 6, numberLength = 4) {
                                const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                                let result = '';
                                for (let i = 0; i < length; i++) {
                                    result += characters.charAt(Math.floor(Math.random() * characters.length));
                                }
                                const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                                return `${result}${number}`;
                            }

                            const megaUrl = await upload(
                                fs.createReadStream(authPath + 'creds.json'),
                                `${randomMegaId()}.json`
                            );
                            const sessionId = megaUrl.replace('https://mega.nz/file/', '');
                            const scanId = sessionId;

                            const msgs = await session.sendMessage(user, { text: `Rudhra~${scanId}` });

                            await session.sendMessage(user, {
                                document: fs.readFileSync('./auth_info_baileys/creds.json'),
                                fileName: 'creds.json',
                                mimetype: 'application/json',
                                caption: "Upload This File To `RUDHRA-BOT SESSION` creds.json Folder",
                            });

                            await session.sendMessage(user, {
                                text: MESSAGE,
                                contextInfo: {
                                    externalAdReply: {
                                        title: "𝗥𝗨𝗗𝗛𝗥𝗔 𝗦𝗘𝗦𝗦𝗜𝗢𝗡 𝗜𝗗",
                                        body: "ʀᴜᴅʜʀᴀ ʙᴏᴛ",
                                        thumbnailUrl: "https://i.imgur.com/Zim2VKH.jpeg",
                                        sourceUrl: "https://github.com/princerudh/rudhra-bot",
                                        mediaUrl: "https://github.com",
                                        mediaType: 1,
                                        renderLargerThumbnail: false,
                                        showAdAttribution: true,
                                    }
                                }
                            }, { quoted: msgs });

                            await delay(1000);
                            fs.emptyDirSync(__dirname + '/auth_info_baileys');
                        }
                    } catch (e) {
                        console.log("Error during file upload or message send: ", e);
                    }
                }

                if (connection === "close") {
                    const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                    if (reason === DisconnectReason.connectionClosed) {
                        console.log("Connection closed!");
                    } else if (reason === DisconnectReason.connectionLost) {
                        console.log("Connection Lost from Server!");
                    } else if (reason === DisconnectReason.restartRequired) {
                        console.log("Restart Required, Restarting...");
                        getPair().catch(err => console.log(err));
                    } else if (reason === DisconnectReason.timedOut) {
                        console.log("Connection TimedOut!");
                    } else {
                        console.log('Connection closed with bot. Please run again.');
                        exec('pm2 restart rudhra');
                    }
                }
            });
        } catch (err) {
            console.log("Error in getPair function: ", err);
            exec('pm2 restart rudhra');
            getPair();
            fs.emptyDirSync(__dirname + '/auth_info_baileys');

            if (!res.headersSent) {
                await res.send({ code: "Try After Few Minutes" });
            }
        }
    }

    await getPair();
});

module.exports = router;
