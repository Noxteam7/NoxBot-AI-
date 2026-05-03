import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import P from "pino";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import readline from "readline";
import pkg from "google-libphonenumber";
import NodeCache from "node-cache";
import pino from "pino";

// استيراد الإعدادات والدوال من index.js
import { config, group, access, sub } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
global.config = config;

/* ========== التوثيق والاقتران ========== */
const authFolder = "sessions";
const credsFile = path.join(authFolder, "creds.json");
const backupDir = path.join(__dirname, "BackupSession");
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

const methodCodeQR = process.argv.includes('qr');
const methodCode = !!config.phoneNumber || process.argv.includes('code');
let rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const question = (text) => new Promise((resolve) => {
  rl.question(text, (answer) => {
    rl.clearLine(process.stdin, 0);
    resolve(answer.trim());
  });
});

const { PhoneNumberUtil } = pkg;
const phoneUtil = PhoneNumberUtil.getInstance();
async function isValidPhoneNumber(number) {
  try {
    number = number.replace(/\s+/g, '');
    if (number.startsWith('+521')) number = number.replace('+521', '+52');
    else if (number.startsWith('+52') && number[4] === '1') number = number.replace('+52 1', '+52');
    const parsed = phoneUtil.parseAndKeepRawInput(number);
    return phoneUtil.isValidNumber(parsed);
  } catch { return false; }
}

let chosenMethod = '1';
if (!methodCodeQR && !methodCode && !fs.existsSync(credsFile)) {
  const line = '⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ 》';
  chosenMethod = await question(
    chalk.yellow(`╭${line}
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('┊')} ${chalk.blue.bold('🔐 طريقة الاقتران')}
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('┊')} ${chalk.green('1')} - QR Code
┊ ${chalk.blueBright('┊')} ${chalk.green('2')} - Pairing Code
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
╰${line}
${chalk.bold.magentaBright('---> ')}`)
  );
  if (!/^[1-2]$/.test(chosenMethod)) chosenMethod = '1';
  rl.close();
}

/* ========== إعدادات اتصال Baileys ========== */
const { state, saveCreds } = await useMultiFileAuthState(authFolder);
const msgRetryCounterCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });
const { version } = await fetchLatestBaileysVersion();

const sock = makeWASocket({
  logger: P({ level: "silent" }),
  printQRInTerminal: chosenMethod === '1' || methodCodeQR,
  browser: ['NoxBot-AI', 'Edge', '20.0.04'],
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }).child({ level: 'silent' }))
  },
  markOnlineOnConnect: false,
  generateHighQualityLinkPreview: true,
  msgRetryCounterCache,
  version
});

global.conn = sock; // للوصول من أي مكان

/* ========== معالجة الاقتران برقم الهاتف ========== */
if ((chosenMethod === '2' || methodCode) && !fs.existsSync(credsFile)) {
  if (!sock.authState.creds.registered) {
    let phoneNumber = config.phoneNumber;
    if (!phoneNumber) {
      do {
        phoneNumber = await question(chalk.bgBlack(chalk.greenBright("📱 أدخل رقم هاتفك (مثال: +20123456789): ")));
        phoneNumber = phoneNumber.replace(/\D/g, '');
        if (!phoneNumber.startsWith('+')) phoneNumber = `+${phoneNumber}`;
      } while (!(await isValidPhoneNumber(phoneNumber)));
      rl.close();
    }
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    setTimeout(async () => {
      let code = await sock.requestPairingCode(cleanNumber);
      code = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log(chalk.bold.bgMagenta.white(`🔐 كود الاقتران: ${code}`));
    }, 2000);
  }
}

/* ========== النسخ الاحتياطي التلقائي للمفاتيح ========== */
async function backupCreds() {
  if (!fs.existsSync(credsFile)) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `creds-${timestamp}.json`);
  fs.copyFileSync(credsFile, backupPath);
  const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('creds-') && f.endsWith('.json'))
    .sort((a, b) => fs.statSync(path.join(backupDir, a)).mtimeMs - fs.statSync(path.join(backupDir, b)).mtimeMs);
  while (backups.length > 3) {
    const oldest = backups.shift();
    fs.unlinkSync(path.join(backupDir, oldest));
  }
}
setInterval(backupCreds, 5 * 60 * 1000);

/* ========== تحميل البلجن (الأوامر) ========== */
const commands = new Map();
async function loadPlugins() {
  const pluginsPath = path.join(__dirname, config.commandsPath);
  if (!fs.existsSync(pluginsPath)) fs.mkdirSync(pluginsPath, { recursive: true });
  const files = fs.readdirSync(pluginsPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const plugin = await import(path.join(pluginsPath, file) + `?update=${Date.now()}`);
      const name = plugin.name || file.replace('.js', '');
      commands.set(name, plugin);
    } catch (err) {
      console.error(chalk.red(`⚠️ فشل تحميل الأمر ${file}: ${err.message}`));
    }
  }
}
await loadPlugins();

/* ========== أحداث الـ Socket ========== */
let installationCodeSent = false;

sock.ev.on("connection.update", async (update) => {
  const { connection, lastDisconnect } = update;
  if (connection === "open") {
    console.log(chalk.green.bold("✅ Bot Connected successfully!"));
    if (!installationCodeSent && config.owners.length > 0) {
      const ownerJid = config.owners[0].jid;
      try {
        await sock.sendMessage(ownerJid, { text: `🔐 *كود التنصيب الخاص بك:*\n\`\`\`NOXE1234\`\`\`` });
        console.log(chalk.green(`✅ تم إرسال كود التنصيب إلى ${ownerJid} (NOXE1234)`));
        installationCodeSent = true;
      } catch (err) {
        console.log(chalk.red(`❌ فشل إرسال الكود: ${err.message}`));
      }
    }
    setTimeout(() => sub(sock), 2000);
  } else if (connection === "close") {
    const reason = lastDisconnect?.error?.output?.statusCode;
    if (reason !== DisconnectReason.loggedOut) {
      console.log(chalk.yellow("🔄 إعادة الاتصال..."));
      // إعادة تشغيل العملية
      process.exit(1);
    } else {
      console.log(chalk.red("❌ تم تسجيل الخروج، احذف مجلد sessions وأعد التشغيل."));
    }
  }
});

sock.ev.on("creds.update", saveCreds);

sock.ev.on("messages.upsert", async ({ messages }) => {
  const msg = messages[0];
  if (!msg.message) return;
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
  const prefix = config.prefix.find(p => text.startsWith(p));
  if (!prefix) return;
  const args = text.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  if (commands.has(cmd)) {
    try {
      await commands.get(cmd).execute(sock, msg, args);
    } catch (err) { console.error(err); }
  }
  access(sock, msg);
});

sock.ev.on("group-participants.update", (data) => {
  group(sock, data);
});

/* ========== تنظيف الملفات المؤقتة ========== */
const tmpDir = path.join(__dirname, "tmp");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
setInterval(() => {
  try {
    const files = fs.readdirSync(tmpDir);
    for (const f of files) {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
    }
    console.log(chalk.cyan("🧹 تم تنظيف الملفات المؤقتة"));
  } catch {}
}, 3 * 60 * 1000);

/* ========== معالجة الأخطاء العامة ========== */
process.on("uncaughtException", (err) => {
  if (err.message.includes("rate-overlimit")) return;
  console.error(chalk.red("uncaughtException:", err));
});
process.on("unhandledRejection", (err) => {
  console.error(chalk.red("unhandledRejection:", err));
});

console.log(chalk.green.bold("🤖 NoxBot-AI يعمل الآن..."));
