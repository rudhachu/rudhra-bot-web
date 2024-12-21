const { exec } = require("child_process");
const { upload } = require("./mega");
const express = require("express");
const router = express.Router();
const pino = require("pino");
const { toBuffer } = require("qrcode");
const path = require("path");
const fs = require("fs-extra");
const { Boom } = require("@hapi/boom");

// Default message
const MESSAGE = process.env.MESSAGE || `
*ᴅᴇᴀʀ ᴜsᴇʀ ᴛʜɪs ɪs ʏᴏᴜʀ sᴇssɪᴏɴ ɪᴅ*\n\n◕ ⚠️ 
*ᴘʟᴇᴀsᴇ ᴅᴏ ɴᴏᴛ sʜᴀʀᴇ ᴛʜɪs ᴄᴏᴅᴇ ᴡɪᴛʜ ᴀɴʏᴏɴᴇ ᴀs ɪᴛ ᴄᴏɴᴛᴀɪɴs ʀᴇǫᴜɪʀᴇᴅ ᴅᴀᴛᴀ ᴛᴏ ɢᴇᴛ ʏᴏᴜʀ ᴄᴏɴᴛᴀᴄᴛ ᴅᴇᴛᴀɪʟs ᴀɴᴅ ᴀᴄᴄᴇss ʏᴏᴜʀ ᴡʜᴀᴛsᴀᴘᴘ*`;

// Clear the existing authentication directory
if (fs.existsSync("./auth_info_baileys")) {
  fs.emptyDirSync(path.join(__dirname, "/auth_info_baileys"));
}

// Main route to handle QR code generation and session management
router.get("/", async (req, res) => {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    Browsers,
    delay,
    DisconnectReason,
    makeInMemoryStore,
  } = require("@whiskeysockets/baileys");

  // List of available browser configurations
  const browserOptions = [
    Browsers.macOS("Safari"),
    Browsers.macOS("Desktop"),
    Browsers.macOS("Chrome"),
    Browsers.macOS("Firefox"),
    Browsers.macOS("Opera"),
  ];

  // Function to pick a random browser
  function getRandomBrowser() {
    return browserOptions[Math.floor(Math.random() * browserOptions.length)];
  }

  const store = makeInMemoryStore({
    logger: pino().child({ level: "silent", stream: "store" }),
  });

  async function Getqr() {
    const { state, saveCreds } = await useMultiFileAuthState(
      path.join(__dirname, "/auth_info_baileys")
    );

    try {
      const session = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: getRandomBrowser(),
      });

      session.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Send QR code
        if (qr && !res.headersSent) {
          try {
            const qrBuffer = await toBuffer(qr);
            res.setHeader("Content-Type", "image/png");
            res.end(qrBuffer);
          } catch (error) {
            console.error("Error generating QR code:", error);
            res.status(500).send("Failed to generate QR code.");
            return;
          }
        }

        // When connection is established
        if (connection === "open") {
          console.log("Connection established!");

          // Generate unique session ID
          function randomMegaId(length = 6, numberLength = 4) {
            const characters =
              "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            let result = "";
            for (let i = 0; i < length; i++) {
              result += characters.charAt(
                Math.floor(Math.random() * characters.length)
              );
            }
            const number = Math.floor(
              Math.random() * Math.pow(10, numberLength)
            );
            return `${result}${number}`;
          }

          const authPath = "./auth_info_baileys/";
          const megaUrl = await upload(
            fs.createReadStream(path.join(authPath, "creds.json")),
            `${randomMegaId()}.json`
          );

          const sessionId = megaUrl.replace("https://mega.nz/file/", "");
          console.log(`
==================== SESSION ID ==========================                   
SESSION-ID ==> ${sessionId}
------------------- SESSION CLOSED -----------------------
          `);

          // Send session ID to user
          const user = session.user.id;
          const msg = await session.sendMessage(user, {
            text: `Rudhra~${sessionId}`,
          });

          await session.sendMessage(user, {
            document: fs.readFileSync("./auth_info_baileys/creds.json"),
            fileName: "creds.json",
            mimetype: "application/json",
            caption:
              "Upload This File To `RUDHRA-BOT SESSION` creds.json Folder",
          });

          await session.sendMessage(
            user,
            {
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
                },
              },
            },
            { quoted: msg }
          );

          await delay(1000);

          try {
            fs.emptyDirSync(path.join(__dirname, "/auth_info_baileys"));
          } catch (err) {
            console.error("Error clearing auth directory:", err);
          }
        }

        // Reconnection logic
        if (connection === "close") {
          const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
          if (reason === DisconnectReason.restartRequired) {
            console.log("Restart Required, Restarting...");
            Getqr().catch(console.error);
          } else if (reason === DisconnectReason.connectionLost) {
            console.log("Connection Lost from Server!");
          } else {
            console.log("Connection closed with bot. Please run again.");
            console.log(reason);
            exec("pm2 restart rudhra");
            process.exit(0);
          }
        }
      });

      session.ev.on("creds.update", saveCreds);
    } catch (err) {
      console.error("Error in Getqr:", err);
      exec("pm2 restart rudhra");
      fs.emptyDirSync(path.join(__dirname, "/auth_info_baileys"));
    }
  }

  Getqr().catch((err) => {
    console.error("Error initializing Getqr:", err);
    fs.emptyDirSync(path.join(__dirname, "/auth_info_baileys"));
    exec("pm2 restart rudhra");
  });
});

module.exports = router;
