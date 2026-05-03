// main.js - المدخل المتقدم للبوت
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, jidNormalizedUser } from "@whiskeysockets/baileys";
import P from "pino";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import chalk from "chalk";
import readline from "readline";
import pkg from "google-libphonenumber";
const { PhoneNumberUtil } = pkg;
const phoneUtil = PhoneNumberUtil.getInstance();
import NodeCache from "node-cache";
import { Boom } from "@hapi/boom";
import lodash from "lodash";
const { chain } = lodash;
import { spawn } from "child_process";
import { watchFile, unwatchFile } from "fs";
import syntaxerror from "syntax-error";
import { format } from "util";
import pino from "pino";

// استيراد من ملفات المشروع
import { config, group, access, sub } from "./index.js";
import UltraDB from "./system/UltraDB.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
global.db = new UltraDB(); // تأكيد
global.config = config;

/* ========== متغيرات عامة ========== */
global.authFile = "sessions"; // نفس المستخدم في index.js القديم
global.creds = "creds.json";
const respaldoDir = path.join(__dirname, "BackupSession");
if (!fs.existsSync(respaldoDir)) fs.mkdirSync(respaldoDir, { recursive: true });

/* ========== دالة عرض لوحة المعلومات ========== */
async function showSystemInfo() {
  const ramInGB = os.totalmem() / (1024 ** 3);
  const freeRamInGB = os.freemem() / (1024 ** 3);
  const packageJsonPath = path.join(__dirname, "package.json");
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const currentTime = new Date().toLocaleString();
    let lineM = '⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ 》';
    console.log(chalk.yellow(`╭${lineM}
┊${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊${chalk.blueBright('┊')}${chalk.yellow(`🖥️ ${os.type()}, ${os.release()} - ${os.arch()}`)}
┊${chalk.blueBright('┊')}${chalk.yellow(`💾 Total RAM: ${ramInGB.toFixed(2)} GB`)}
┊${chalk.blueBright('┊')}${chalk.yellow(`💽 Free RAM: ${freeRamInGB.toFixed(2)} GB`)}
┊${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊${chalk.blueBright('┊')} ${chalk.blue.bold('🟢 INFORMATION :')}
┊${chalk.blueBright('┊')} ${chalk.blueBright('┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')} 
┊${chalk.blueBright('┊')}${chalk.cyan(`💚 Name: ${packageJson.name}`)}
┊${chalk.blueBright('┊')}${chalk.cyan(`𓃠 Version: ${packageJson.version}`)}
┊${chalk.blueBright('┊')}${chalk.cyan(`💜 Description: ${packageJson.description}`)}
┊${chalk.blueBright('┊')}${chalk.cyan(`😺 Project Author: ${packageJson.author}`)}
┊${chalk.blueBright('┊')}${chalk.blueBright('┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')} 
┊${chalk.blueBright('┊')}${chalk.yellow('💜 Colaborador: NoxTeam7')}
┊${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')} 
┊${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊${chalk.blueBright('┊')}${chalk.cyan('⏰ Current Time :')}
┊${chalk.blueBright('┊')}${chalk.cyan(`${currentTime}`)}
┊${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')} 
╰${lineM}`));
  } catch (err) {
    console.log(chalk.red("Could not read package.json:", err.message));
  }
}

/* ========== التوثيق والاقتران ========== */
const methodCodeQR = process.argv.includes('qr');
const methodCode = !!config.phoneNumber || process.argv.includes('code');
let rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const question = (texto) => new Promise((resolver) => {
  rl.question(texto, (respuesta) => {
    rl.clearLine(process.stdin, 0);
    resolver(respuesta.trim());
  });
});

async function isValidPhoneNumber(number) {
  try {
    number = number.replace(/\s+/g, '');
    if (number.startsWith('+521')) number = number.replace('+521', '+52');
    else if (number.startsWith('+52') && number[4] === '1') number = number.replace('+52 1', '+52');
    const parsedNumber = phoneUtil.parseAndKeepRawInput(number);
    return phoneUtil.isValidNumber(parsedNumber);
  } catch { return false; }
}

let opcion = '1'; // افتراضي QR
if (!methodCodeQR && !methodCode && !fs.existsSync(`./${global.authFile}/creds.json`)) {
  let lineM = '⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ 》';
  opcion = await question(
    `╭${lineM}  
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('┊')} ${chalk.blue.bold('🔐 طريقة الاقتران')}
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('┊')} ${chalk.green('1')} - QR Code
┊ ${chalk.blueBright('┊')} ${chalk.green('2')} - Pairing Code (رقم الهاتف)
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('┊')} ${chalk.red('اختر 1 أو 2')}
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
╰${lineM}
${chalk.bold.magentaBright('---> ')}`);
  if (!/^[1-2]$/.test(opcion)) opcion = '1';
  rl.close();
}

/* ========== إعدادات الاتصال ========== */
const { state, saveCreds } = await useMultiFileAuthState(global.authFile);
const msgRetryCounterCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });
const { version } = await fetchLatestBaileysVersion();

const connectionOptions = {
  logger: P({ level: "silent" }),
  printQRInTerminal: opcion === '1' || methodCodeQR,
  browser: ['NoxBot-AI', 'Edge', '20.0.04'],
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }).child({ level: 'silent' }))
  },
  markOnlineOnConnect: false,
  generateHighQualityLinkPreview: true,
  msgRetryCounterCache,
  version
};

let sock = makeWASocket(connectionOptions);
global.conn = sock;

// معالجة الاقتران إذا كان الخيار 2
if ((opcion === '2' || methodCode) && !fs.existsSync(`./${global.authFile}/creds.json`)) {
  if (!sock.authState.creds.registered) {
    let phoneNumber = config.phoneNumber;
    if (!phoneNumber) {
      do {
        phoneNumber = await question(chalk.bgBlack(chalk.bold.greenBright("📱 أدخل رقم هاتفك مع رمز البلد (مثال: +20123456789): ")));
        phoneNumber = phoneNumber.replace(/\D/g, '');
        if (!phoneNumber.startsWith('+')) phoneNumber = `+${phoneNumber}`;
      } while (!(await isValidPhoneNumber(phoneNumber)));
      rl.close();
    }
    const addNumber = phoneNumber.replace(/\D/g, '');
    setTimeout(async () => {
      let codeBot = await sock.requestPairingCode(addNumber);
      codeBot = codeBot?.match(/.{1,4}/g)?.join('-') || codeBot;
      console.log(chalk.bold.white(chalk.bgMagenta("🔐 كود الاقتران:")), chalk.bold.white(codeBot));
    }, 2000);
  }
}

/* ========== Backup و Restore ========== */
async function backupCreds() {
  const credsFile = path.join(global.authFile, global.creds);
  if (!fs.existsSync(credsFile)) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const newBackup = path.join(respaldoDir, `creds-${timestamp}.json`);
  fs.copyFileSync(credsFile, newBackup);
  const backups = fs.readdirSync(respaldoDir).filter(f => f.startsWith('creds-') && f.endsWith('.json'))
    .sort((a, b) => fs.statSync(path.join(respaldoDir, a)).mtimeMs - fs.statSync(path.join(respaldoDir, b)).mtimeMs);
  while (backups.length > 3) {
    const oldest = backups.shift();
    fs.unlinkSync(path.join(respaldoDir, oldest));
  }
}
setInterval(backupCreds, 5 * 60 * 1000);

async function restoreCreds() {
  const backups = fs.readdirSync(respaldoDir).filter(f => f.startsWith('creds-') && f.endsWith('.json'))
    .sort((a, b) => fs.statSync(path.join(respaldoDir, b)).mtimeMs - fs.statSync(path.join(respaldoDir, a)).mtimeMs);
  if (backups.length === 0) return;
  const latestBackup = path.join(respaldoDir, backups[0]);
  fs.copyFileSync(latestBackup, path.join(global.authFile, global.creds));
  console.log(chalk.green(`[✅] Restored from ${backups[0]}`));
}

/* ========== تحميل البلاتجن (plugins) ========== */
const commands = new Map();
function loadPlugins() {
  const pluginsPath = path.join(__dirname, config.commandsPath);
  if (!fs.existsSync(pluginsPath)) fs.mkdirSync(pluginsPath, { recursive: true });
  const files = fs.readdirSync(pluginsPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const plugin = await import(path.join(pluginsPath, file) + `?update=${Date.now()}`);
      commands.set(plugin.name || file.replace('.js', ''), plugin);
    } catch (e) {
      console.error(chalk.red(`Failed to load plugin ${file}:`, e.message));
    }
  }
}

/* ========== أحداث الاتصال ========== */
sock.ev.on("connection.update", async (update) => {
  const { connection, lastDisconnect, qr } = update;
  if (connection === "open") {
    console.log(chalk.green.bold("✅ Bot Connected successfully!"));
    // إرسال كود التنصيب NOXE1234 لأول مالك
    if (!global.installationCodeSent && config.owners.length > 0) {
      const ownerJid = config.owners[0].jid;
      try {
        await sock.sendMessage(ownerJid, { text: `🔐 *كود التنصيب الخاص بك:*\n\`\`\`NOXE1234\`\`\`` });
        console.log(chalk.green(`✅ Installation code sent to ${ownerJid} (NOXE1234)`));
        global.installationCodeSent = true;
      } catch (err) {
        console.log(chalk.red(`❌ Failed to send code: ${err.message}`));
      }
    }
    // تشغيل نظام sub بعد 2 ثانية
    setTimeout(() => sub(sock), 2000);
  } else if (connection === "close") {
    const reason = lastDisconnect?.error?.output?.statusCode;
    if (reason !== DisconnectReason.loggedOut) {
      console.log(chalk.yellow("🔄 Reconnecting..."));
      await restoreCreds();
      startBot();
    } else {
      console.log(chalk.red("❌ Logged out, remove sessions folder and restart."));
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
    } catch (e) { console.error(e); }
  }
  access(sock, msg);
});

sock.ev.on("group-participants.update", (data) => {
  group(sock, data);
});

/* ========== وظائف إضافية: تنظيف tmp و sessions ========== */
const tmpDir = path.join(__dirname, "tmp");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
setInterval(() => {
  if (fs.existsSync(tmpDir)) {
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      try { fs.unlinkSync(path.join(tmpDir, file)); } catch {}
    }
    console.log(chalk.cyan("🧹 Temporary files cleaned"));
  }
}, 3 * 60 * 1000);

/* ========== بدء البوت ========== */
async function startBot() {
  await showSystemInfo();
  loadPlugins();
  console.log(chalk.green.bold("🤖 NoxBot-AI is running..."));
}
startBot();

/* ========== معالجة الأخطاء العامة ========== */
process.on("uncaughtException", (e) => {
  if (e.message.includes("rate-overlimit")) return;
  console.error(chalk.red("Uncaught Exception:", e));
});
process.on("unhandledRejection", (err) => {
  console.error(chalk.red("Unhandled Rejection:", err));
});
