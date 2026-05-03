import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import P from "pino";
import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";

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

/* =========== Pretty Console Logs ========== */
function showSystemInfo() {
  const totalRam = os.totalmem() / (1024 ** 3);
  const freeRam = os.freemem() / (1024 ** 3);
  const currentTime = new Date().toLocaleString();
  const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));

  const lineM = "─".repeat(32);
  console.log(`
${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊${chalk.blueBright('┊')} ${chalk.yellow(`🖥️ ${os.type()}, ${os.release()} - ${os.arch()}`)}
┊${chalk.blueBright('┊')} ${chalk.yellow(`💾 Total RAM: ${totalRam.toFixed(2)} GB`)}
┊${chalk.blueBright('┊')} ${chalk.yellow(`💽 Free RAM: ${freeRam.toFixed(2)} GB`)}
┊${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊${chalk.blueBright('┊')} ${chalk.blue.bold('🟢 INFORMATION :')}
┊${chalk.blueBright('┊')} ${chalk.blueBright('┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')} 
┊${chalk.blueBright('┊')}${chalk.cyan(`💚 Name: ${packageJson.name}`)}
┊${chalk.blueBright('┊')}${chalk.cyan(`𓃠 Version: ${packageJson.version}`)}
┊${chalk.blueBright('┊')}${chalk.cyan(`💜 Description: ${packageJson.description}`)}
┊${chalk.blueBright('┊')}${chalk.cyan(`😺 Author: ${packageJson.author}`)}
┊${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')} 
┊${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊${chalk.blueBright('┊')}${chalk.cyan(`⏰ Current Time : ${currentTime}`)}
┊${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')} 
╰${lineM}
${chalk.green.bold('🤖 Bot is starting...')}
`);
}

/* =========== Start Bot ========== */
let installationCodeSent = false;

async function startBot() {
  showSystemInfo();

  const { state, saveCreds } = await useMultiFileAuthState("sessions");

  const sock = makeWASocket({
    logger: P({ level: "silent" }),
    auth: state
  });

  loadPlugins();

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(chalk.red(`❌ Disconnected, reason: ${reason || "unknown"}`));
      if (reason !== DisconnectReason.loggedOut) {
        console.log(chalk.yellow("🔄 Reconnecting..."));
        startBot();
      }
    } else if (connection === "open") {
      console.log(chalk.green.bold("✅ Bot Connected successfully!"));

      // إرسال كود التنصيب للمطور الأول
      if (!installationCodeSent && config.owners.length > 0) {
        const ownerJid = config.owners[0].jid;
        const codeMessage = `🔐 *كود التنصيب الخاص بك:*\n\`\`\`NOXE1234\`\`\``;

        console.log(chalk.cyan(`📤 Sending installation code to ${ownerJid} ...`));

        try {
          await sock.sendMessage(ownerJid, { text: codeMessage });
          console.log(chalk.green(`✅ Installation code sent to ${ownerJid} (NOXE1234)`));
          installationCodeSent = true;
        } catch (err) {
          console.log(chalk.red(`❌ Failed to send code: ${err.message}`));
        }
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

    console.log(chalk.magenta(`📨 Command received: ${cmd} from ${msg.key.remoteJid}`));

    if (commands.has(cmd)) {
      try {
        commands.get(cmd).execute(sock, msg, args);
        console.log(chalk.green(`✓ Executed ${cmd}`));
      } catch (e) {
        console.error(chalk.red(`✗ Error in ${cmd}:`, e));
      }
    }

    access(sock, msg);
  });

  sock.ev.on("group-participants.update", (data) => {
    console.log(chalk.yellow(`👥 Group update: ${data.action} in ${data.id}`));
    group(sock, data);
  });

  setTimeout(() => {
    sub(sock);
  }, 2000);
}

startBot();

process.on("uncaughtException", (e) => {
  if (e.message.includes("rate-overlimit")) return;
  console.error(chalk.red("Uncaught Exception:", e));
});

process.on("unhandledRejection", (err) => {
  console.error(chalk.red("Unhandled Rejection:", err));
});
