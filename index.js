import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import P from "pino";
import fs from "fs";
import path from "path";

import { group, access } from "./system/control.js";
import UltraDB from "./system/UltraDB.js";
import sub from "./sub.js";

/* =========== Database ========== */
if (!global.db) {
  global.db = new UltraDB();
}

/* =========== Config ========== */
const config = {
  phoneNumber: "20123456789",
  prefix: [".", "/", "!"],
  owners: [
    { name: "mix", jid: "33760509044@s.whatsapp.net" },
    { name: "escanor", jid: "212727621948@s.whatsapp.net" }
  ],
  commandsPath: "./plugins",
  info: {
    nameBot: "  𝐍𝐎𝐗𝟕 🍷 ",
    nameChannel: "🍷𝐍𝐎𝐗𝟕 𝐂𝐇𝐀𝐍𝐍𝐄𝐋",
  },
  images: [
    "https://i.pinimg.com/originals/11/26/97/11269786cdb625c60213212aa66273a9.png",
    "https://i.pinimg.com/originals/e2/21/20/e221203f319df949ee65585a657501a2.jpg",
    "https://i.pinimg.com/originals/bb/77/0f/bb770fad66a634a6b3bf93e9c00bf4e5.jpg"
  ]
};

/* =========== Load Plugins ========== */
const commands = new Map();

function loadPlugins() {
  const files = fs.readdirSync(config.commandsPath);
  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    const plugin = require(path.resolve(config.commandsPath, file));
    commands.set(plugin.name, plugin);
  }
}

/* =========== Simple Logger ========== */
function logSuccess(msg) {
  console.log(`\x1b[32m✅ ${new Date().toLocaleString()} - ${msg}\x1b[0m`);
}

function logError(msg) {
  console.error(`\x1b[31m❌ ${new Date().toLocaleString()} - ${msg}\x1b[0m`);
}

function logInfo(msg) {
  console.log(`\x1b[36m📘 ${new Date().toLocaleString()} - ${msg}\x1b[0m`);
}

/* =========== Start Bot ========== */
let installationCodeSent = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("sessions");

  const sock = makeWASocket({
    logger: P({ level: "silent" }),
    auth: state
  });

  loadPlugins();

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      logError(`Disconnected, reason: ${reason}`);
      if (reason !== DisconnectReason.loggedOut) {
        logInfo("Reconnecting...");
        startBot();
      }
    } else if (connection === "open") {
      logSuccess("Bot Connected successfully");

      if (!installationCodeSent && config.owners.length > 0) {
        const ownerJid = config.owners[0].jid;
        const codeMessage = `🔐 *كود التنصيب الخاص بك:*\n\`\`\`NOXE1234\`\`\``;

        logInfo(`📤 محاولة إرسال كود التنصيب إلى ${ownerJid} ...`);

        sock.sendMessage(ownerJid, { text: codeMessage })
          .then(() => {
            logSuccess(`تم إرسال كود التنصيب بنجاح إلى ${ownerJid} (الكود: NOXE1234)`);
            installationCodeSent = true;
          })
          .catch(err => {
            logError(`فشل إرسال كود التنصيب إلى ${ownerJid}: ${err.message}`);
          });
      } else if (installationCodeSent) {
        logInfo("كود التنصيب تم إرساله مسبقًا، لن يتم إعادة الإرسال.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    const prefix = config.prefix.find((p) => text.startsWith(p));
    if (!prefix) return;

    const args = text.slice(prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    if (commands.has(cmd)) {
      try {
        commands.get(cmd).execute(sock, msg, args);
      } catch (e) {
        console.error(e);
      }
    }

    access(sock, msg);
  });

  sock.ev.on("group-participants.update", (data) => {
    group(sock, data);
  });

  setTimeout(() => {
    sub(sock);
  }, 2000);
}

startBot();

process.on("uncaughtException", (e) => {
  if (e.message.includes("rate-overlimit")) return;
  logError(`Uncaught Exception: ${e.message}`);
});

process.on("unhandledRejection", (err) => {
  logError(`Unhandled Rejection: ${err}`);
});
