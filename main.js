import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import P from "pino";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import chalk from "chalk";
import NodeCache from "node-cache";
import pino from "pino";
import { config } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let group, access, sendWithImage, UltraDB, sub;
let printIncomingMessage, printOutgoingMessage, printCommandExecution, printGroupEvent, printSystemInfo, printError;

try {
  const control = await import("./system/control.js");
  group = control.group;
  access = control.access;
  sendWithImage = control.sendWithImage;
  console.log(chalk.green("  🔹 تم تحميل: control.js"));
} catch (e) {
  console.log(chalk.red("❌ فشل تحميل control.js:", e.message));
}

let printer;
try {
  printer = await import("./system/print.js");
  printIncomingMessage = printer.printIncomingMessage || (async () => {});
  printOutgoingMessage = printer.printOutgoingMessage || (async () => {});
  printCommandExecution = printer.printCommandExecution || (() => {});
  printGroupEvent = printer.printGroupEvent || (() => {});
  printSystemInfo = printer.printSystemInfo || (() => {});
  printError = printer.printError || (() => {});
  console.log(chalk.green("  🔹 تم تحميل: print.js"));
} catch (e) {
  console.log(chalk.yellow("⚠️ print.js غير متوفر"));
  printIncomingMessage = async () => {};
  printOutgoingMessage = async () => {};
  printCommandExecution = () => {};
  printGroupEvent = () => {};
  printSystemInfo = () => {};
  printError = () => {};
}

try {
  const UltraDBModule = await import("./system/UltraDB.js");
  UltraDB = UltraDBModule.default;
} catch (e) {
  UltraDB = class {
    constructor() { return { groups: {}, users: {} }; }
  };
}

try {
  const subModule = await import("./system/sub.js");
  sub = subModule.default;
} catch (e) {
  sub = async () => {};
}

global.config = config;
global.pairingCode = null;
global.__reconnectPending = false;
global.__backupIntervalStarted = false;
const COUNTRY_API_URL = "https://drive.google.com/uc?export=download&id=18AjWHXAfMw0vroZYxtYsXdtzeOxiJTTt";
let countryDataset = null;
let countryDatasetLoading = null;

if (!global.db) {
  try { global.db = new UltraDB(); }
  catch (e) { global.db = { groups: {}, users: {} }; }
}

function mergeDefaults(target, defaults) {
  if (!target || typeof target !== "object") return;
  for (const key of Object.keys(defaults)) {
    if (target[key] === undefined) target[key] = defaults[key];
  }
}

function normalizeCountryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const dialCode = String(
    entry.dialCode || entry.dial_code || entry.phone_code || entry.callingCode || ""
  ).trim();
  if (!dialCode) return null;
  return {
    dialCode,
    countryname: entry.countryname || entry.name || entry.country || "Unknown",
    countrycode: entry.countrycode || entry.code || entry.iso2 || "UN",
    countrylang: entry.countrylang || entry.language || entry.lang || "Unknown",
    countryemo: entry.countryemo || entry.emoji || "🌍",
    timezone: entry.timezone || entry.tz || "UTC"
  };
}

function pickCountryByPhone(phoneNumber) {
  if (!countryDataset || !Array.isArray(countryDataset) || !phoneNumber) return null;
  const clean = String(phoneNumber).replace(/\D/g, "");
  let best = null;
  let bestLen = -1;
  for (const item of countryDataset) {
    const dial = String(item.dialCode || "").replace(/\D/g, "");
    if (!dial) continue;
    if (clean.startsWith(dial) && dial.length > bestLen) {
      best = item;
      bestLen = dial.length;
    }
  }
  return best;
}

function textFromQuotedProto(inner) {
  if (!inner || typeof inner !== "object") return "";
  return (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    ""
  );
}

function quotedFromBaileysMsg(msg) {
  const inner = msg?.message;
  if (!inner) return undefined;
  for (const block of [
    inner.extendedTextMessage,
    inner.imageMessage,
    inner.videoMessage,
    inner.documentMessage
  ]) {
    const ci = block?.contextInfo;
    const qm = ci?.quotedMessage;
    const sid = ci?.stanzaId;
    if (qm && sid) {
      return {
        id: sid,
        key: {
          id: sid,
          remoteJid: ci.remoteJid || msg?.key?.remoteJid,
          participant: ci.participant
        },
        message: qm,
        text: textFromQuotedProto(qm)
      };
    }
  }
  return undefined;
}

async function loadCountryDataset() {
  if (countryDataset) return countryDataset;
  if (countryDatasetLoading) return countryDatasetLoading;

  countryDatasetLoading = (async () => {
    try {
      const res = await fetch(COUNTRY_API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
      countryDataset = arr.map(normalizeCountryEntry).filter(Boolean);
      console.log(chalk.green(`🌐 تم تحميل بيانات الدول: ${countryDataset.length}`));
    } catch (e) {
      countryDataset = [];
      console.log(chalk.yellow(`⚠️ تعذر تحميل ملف الدول، سيتم استخدام القيم الافتراضية (${e.message})`));
    } finally {
      countryDatasetLoading = null;
    }
    return countryDataset;
  })();

  return countryDatasetLoading;
}

async function ensureDatabaseEntities(msg, sock) {
  try {
    const sender = msg?.key?.participant || msg?.key?.remoteJid || msg?.sender;
    const chatId = msg?.key?.remoteJid || msg?.chat;
    const botId = sock?.user?.id || sock?.user?.jid;
    if (!sender || !chatId || !botId || !global.db) return;
    await loadCountryDataset();

    const phoneNumber = sender.split("@")[0] || "";
    const country = pickCountryByPhone(phoneNumber);

    const userDefaults = {
      afk: 0,
      wait: 0,
      afkReason: "",
      age: 0,
      autolevelup: true,
      bank: 0,
      banned: false,
      BannedReason: "",
      Banneduser: false,
      coin: 0,
      exp: 0,
      mute: false,
      gold: 0,
      level: 0,
      limit: 20,
      money: 15,
      name: msg?.pushName || "",
      pc: 0,
      premium: false,
      premiumTime: 0,
      registered: false,
      reglast: 0,
      regTime: 0,
      role: "new user",
      warn: 0,
      phoneNumber,
      /*language: "ar",
      dialCode: country?.dialCode || "+20",
      countryname: country?.countryname || "Egypt",
      countrycode: country?.countrycode || "EG",
      countrylang: country?.countrylang || "Arabic",
      countryemo: country?.countryemo || "🇪🇬",
      timezone: country?.timezone || "Africa/Cairo",*/
      lastCommandTime: 0,
      commandCount: 0
    };

    const chatDefaults = {
      isBanned: false,
      welcome: true,
      detect: true,
      detect2: false,
      sWelcome: "",
      sBye: "",
      sPromote: "",
      sDemote: "",
      antidelete: false,
      modohorny: true,
      autosticker: false,
      audios: true,
      antiLink: false,
      antiLink2: false,
      antiviewonce: false,
      antiToxic: false,
      antiTraba: false,
      antiArab: false,
      antiArab2: false,
      antiporno: false,
      modoadmin: false,
      simi: false,
      game: true,
      expired: 0,
      language: "ar"
    };

    const settingsDefaults = {
      self: false,
      autoread: false,
      autoread2: false,
      restrict: false,
      antiCall: false,
      antiPrivate: false,
      modejadibot: false,
      antispam: false,
      audios_bot: false,
      modoia: false
    };

    const user = global.db.users[sender];
    const chat = global.db.chats[chatId];
    const settings = global.db.settings[botId];

    mergeDefaults(user, userDefaults);
    mergeDefaults(chat, chatDefaults);
    mergeDefaults(settings, settingsDefaults);
  } catch {}
}

function showStartupScreen() {
  console.clear();
  console.log(chalk.green.bold("\n╔══════════════════════════════╗"));
  console.log(chalk.green.bold("║       NOXBOT-AI  started     ║"));
  console.log(chalk.green.bold("╚══════════════════════════════╝\n"));
  console.log(chalk.cyan.bold(`  ${config.info?.nameBot || "NOXBOT"}\n`));
  console.log(chalk.white(`  Created by: @NoxTeam7\n`));
}

const authRoot    = path.join(__dirname, "authFolder");
const authFolder  = path.join(authRoot, "sessions");
const backupDir   = path.join(authRoot, "BackupSession");
const tmpDir      = path.join(__dirname, "tmp");
const pluginsPath = path.join(__dirname, config.commandsPath || "./plugins");

for (const dir of [authRoot, authFolder, backupDir, tmpDir, pluginsPath]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const commands = new Map();
const aliases = new Map();

global.commands = commands;
global.aliases = aliases;

/** Baileys can emit duplicate upserts / offline sync replays (`append`). */
const stanzaDedupSeen = new Map();
const STANZA_DEDUP_MS = 3 * 60 * 1000;

function pruneStanzaDedupMap() {
  const now = Date.now();
  const cutoff = now - STANZA_DEDUP_MS;
  for (const [k, t] of stanzaDedupSeen) {
    if (t < cutoff) stanzaDedupSeen.delete(k);
  }
}

function isDuplicateUpsert(msg) {
  pruneStanzaDedupMap();
  const id = msg?.key?.id;
  const remote = msg?.key?.remoteJid;
  if (!id || !remote) return false;
  const dedupKey = `${remote}:${id}`;
  if (stanzaDedupSeen.has(dedupKey)) return true;
  stanzaDedupSeen.set(dedupKey, Date.now());
  return false;
}

async function loadPlugins() {
  global.beforeHandlers = [];

  if (!fs.existsSync(pluginsPath)) {
    console.log(chalk.yellow("⚠️ مجلد plugins غير موجود"));
    return;
  }

  const files = fs.readdirSync(pluginsPath).filter(f => f.endsWith(".js"));

  for (const file of files) {
    const name = file.replace(".js", "");

    try {
      const pluginModule = await import(
        path.join(pluginsPath, file) + `?t=${Date.now()}`
      );

      const plugin = pluginModule.default || pluginModule;

      // ✅ جمع كل الأوامر من أي مكان
      const cmdListRaw =
        plugin.command ||
        plugin.commands ||
        plugin.execute?.command ||
        [];

      const cmdList = Array.isArray(cmdListRaw)
        ? cmdListRaw
        : typeof cmdListRaw === "string"
          ? [cmdListRaw]
          : [];

      // 🔥 أهم تعديل: أول أمر يكون الأساسي بدل اسم الملف
      const primary = (cmdList[0] || name).toLowerCase();

      commands.set(primary, plugin);

      // تسجيل باقي الأوامر كـ aliases
      for (const cmd of cmdList) {
        if (typeof cmd === "string") {
          aliases.set(cmd.toLowerCase(), primary);
        }
      }

      // before handlers
      if (typeof plugin === "function" && plugin.runBefore === true) {
        global.beforeHandlers.push(plugin);
        console.log(chalk.gray(`  🔔 before: ${name}`));
      }

      // دعم regex commands
      if (plugin.command && plugin.command instanceof RegExp) {
        console.log(chalk.blue(`  🔗 regex command: ${name}`));
      }

      // t- shortcut alias
      if (name.startsWith("t-")) {
        const shortName = name.replace("t-", "");
        aliases.set(shortName.toLowerCase(), primary);
        console.log(chalk.blue(`  🔗 Alias: ${shortName} → ${primary}`));
      }

      console.log(chalk.green(`  ✅ تم تحميل: ${name} → primary: ${primary}`));

      if (typeof plugin !== "function" && typeof plugin.execute !== "function") {
        console.log(chalk.yellow(`  ⚠️ تحذير: ${name} لا يحتوي على execute`));
      }

    } catch (err) {
      console.log(chalk.red(`  ❌ فشل تحميل ${file}: ${err.message}`));
    }
  }

  console.log(chalk.cyan(`📦 تم تحميل ${commands.size} أمر`));
  console.log(chalk.cyan(`📋 Aliases: ${[...aliases.keys()].join(", ")}`));
}

async function backupCreds() {
  const credsFile = path.join(authFolder, "creds.json");
  if (!fs.existsSync(credsFile)) return;
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `creds-${timestamp}.json`);
    fs.copyFileSync(credsFile, backupPath);
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith("creds-"))
      .sort();
    while (backups.length > 3)
      fs.unlinkSync(path.join(backupDir, backups.shift()));
  } catch (e) {}
}

async function askLinkMethod() {
  if (global.__pairingMethod === "qr" || global.__pairingMethod === "code") {
    return global.__pairingMethod;
  }

  const rl = createInterface({ input, output });
  try {
    console.log(chalk.yellow("\nاختر طريقة الربط:"));
    console.log(chalk.cyan("1) QR Code"));
    console.log(chalk.cyan("2) Pairing Code"));
    const answer = (await rl.question(chalk.white("اكتب 1 أو 2 ثم Enter: "))).trim();

    const method = answer === "1" ? "qr" : "code";
    global.__pairingMethod = method;
    console.log(chalk.green(`✅ تم اختيار: ${method === "qr" ? "QR Code" : "Pairing Code"}\n`));
    return method;
  } catch {
    global.__pairingMethod = "code";
    return "code";
  } finally {
    rl.close();
  }
}

async function startBot() {
  showStartupScreen();
  await loadPlugins();

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const msgRetryCounterCache = new NodeCache({ stdTTL: 0 });
  const { version } = await fetchLatestBaileysVersion();
  const hasExistingSession = () =>
    !!(state?.creds?.registered || state?.creds?.me?.id || state?.creds?.account);

  let selectedLinkMethod = "code";
  if (!hasExistingSession()) {
    selectedLinkMethod = await askLinkMethod();
  }

  const sock = makeWASocket({
    logger: P({ level: "silent" }),
    browser: ["macOS", "Safari", "17.4"],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
    },
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true,
    msgRetryCounterCache,
    version,
    printQRInTerminal: selectedLinkMethod === "qr"
  });

  global.conn = sock;

  /** يُحمَّل مرة واحدة: serialize/protoType + دوال conn؛ يُستخدم smsg لربط m.reply / m.react */
  let socketExtrasMod = null;
  try {
    socketExtrasMod = await import("./system/lib/socketExtras.js");
    socketExtrasMod.applySocketExtras(sock);
  } catch (e) {
    console.log(chalk.yellow(`⚠️ socketExtras.js: ${e.message}`));
  }

  let codeSent = false;
  let pairingRequested = false;

  const requestPairingCode = async () => {
    if (pairingRequested || hasExistingSession()) return;
    pairingRequested = true;

    const cleanNumber = config.phoneNumber?.replace(/\D/g, "");
    if (!cleanNumber) {
      console.log(chalk.yellow("⚠️ رقم الجوال غير موجود، سيتم استخدام QR code"));
      return;
    }

    console.log(chalk.cyan(`⏳ جاري طلب كود الاقتران للرقم: +${cleanNumber}`));
    try {
      await new Promise(r => setTimeout(r, 3000));
      const code = await sock.requestPairingCode(cleanNumber);

      if (code) {
        global.pairingCode = code;
        const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;
        console.log(chalk.bold.bgGreen.black(`\n╔══════════════════════════════════════╗`));
        console.log(chalk.bold.bgGreen.black(`║   ✅  PAIRING CODE: ${formattedCode.padEnd(14)} ║`));
        console.log(chalk.bold.bgGreen.black(`╚══════════════════════════════════════╝\n`));
        console.log(chalk.yellow("📲 افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز ← أدخل الكود"));
      }
    } catch (err) {
      console.error(chalk.red(`❌ فشل الحصول على كود الاقتران: ${err.message}`));
      console.log(chalk.yellow("🔄 سيتم عرض رمز QR في التيرمينال..."));
    }
  };

  if (selectedLinkMethod === "code") {
    setTimeout(requestPairingCode, 4000);
  } else {
    console.log(chalk.cyan("📷 تم تفعيل وضع QR، امسح الكود من واتساب.\n"));
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open" && !codeSent) {
      console.log(chalk.green.bold("\n✅ البوت متصل بنجاح!"));
      console.log(chalk.cyan("🤖 البوت جاهز لاستقبال الرسائل...\n"));
      if (sub) setTimeout(() => sub(sock), 2000);
      if (!global.__backupIntervalStarted) {
        setInterval(backupCreds, 5 * 60 * 1000);
        global.__backupIntervalStarted = true;
      }
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(chalk.red(`🔴 انقطع الاتصال - الكود: ${reason}`));
      if (reason === DisconnectReason.loggedOut) {
        console.log(chalk.red("⚠️ تم تسجيل الخروج، احذف مجلد sessions وأعد التشغيل"));
        process.exit(0);
      } else {
        if (!global.__reconnectPending) {
          global.__reconnectPending = true;
          console.log(chalk.yellow("🔄 جاري إعادة الاتصال..."));
          setTimeout(() => {
            global.__reconnectPending = false;
            startBot();
          }, 5000);
        } else {
          console.log(chalk.gray("⏳ إعادة اتصال مجدولة بالفعل..."));
        }
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      const msg = messages[0];
      if (!msg?.message) return;
      if (type === "append") return;
      if (msg.key?.fromMe) return;
      if (isDuplicateUpsert(msg)) return;

      await ensureDatabaseEntities(msg, sock);

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";

      const sm = socketExtrasMod?.smsg
        ? socketExtrasMod.smsg(sock, msg)
        : msg;
      if (socketExtrasMod?.smsg) sm.text = text;

      if (text.trim()) {
        try {
          await printIncomingMessage(sock, sm, text);
        } catch (e) {
          console.log(chalk.cyan(`📩 من: ${msg.pushName || msg.key.remoteJid} | 📝 ${text}`));
        }
      }

      const prefix = config.prefix?.find(p => text.startsWith(p));
      const trimmedLower = text.trim().toLowerCase();
      const ownerJids = new Set(
        (config.owners || [])
          .map((o) => (typeof o === "string" ? o : o?.jid))
          .filter(Boolean)
      );

      /**
       * Run a loaded plugin command (prefixed or no-prefix trigger).
       */
      const invokeLoadedPlugin = async (targetCmd, args, invocationPrefix) => {
        if (!commands.has(targetCmd)) return false;

        const plugin = commands.get(targetCmd);
        console.log(chalk.yellow(`⚡ تنفيذ: ${targetCmd}${invocationPrefix ? "" : " (بدون برفكس)"}`));

        try {
          sm.args = args;
          Object.defineProperty(sm, "quoted", {
            value: quotedFromBaileysMsg(msg),
            writable: true,
            enumerable: true,
            configurable: true
          });
          const normalizedMsg = sm;

          const noPrefixText = args.join(" ").trim();
          let groupMeta;
          if (targetCmd === "exec" && normalizedMsg.chat?.endsWith("@g.us")) {
            groupMeta = await sock.groupMetadata(normalizedMsg.chat).catch(() => null);
          }

          const pluginCtx = {
            conn: sock,
            args,
            text: noPrefixText,
            noPrefix: noPrefixText,
            command: targetCmd,
            prefix: invocationPrefix,
            usedPrefix: invocationPrefix,
            isROwner: ownerJids.has(normalizedMsg.sender),
            isOwner: ownerJids.has(normalizedMsg.sender),
            groupMetadata: groupMeta,
            bot: { config }
          };

          if (typeof plugin === "function") {
            await plugin(normalizedMsg, pluginCtx);
          } else if (typeof plugin.execute === "function") {
            await plugin.execute(sock, normalizedMsg, args);
          } else {
            throw new Error(`لا يوجد دالة execute!`);
          }
          printCommandExecution(targetCmd, "success");
          console.log(chalk.green(`✅ تم تنفيذ ${targetCmd}`));
        } catch (err) {
          printError(`الأمر: ${targetCmd}`, err);
          printCommandExecution(targetCmd, "error", err.message);
          console.log(chalk.red(`❌ فشل ${targetCmd}: ${err.message}`));
          if (access) await access(sock, sm, "error").catch(() => {});
        }
        return true;
      };

      if (!prefix) {
        const chatId = sm.chat || msg?.key?.remoteJid || msg?.chat;
        const senderId =
          sm.sender ||
          msg?.key?.participant ||
          msg?.key?.remoteJid ||
          msg?.sender;

        for (const [plugName, plug] of commands) {
          if (!plug?.customPrefix) continue;
          const re =
            plug.customPrefix instanceof RegExp
              ? plug.customPrefix
              : new RegExp(plug.customPrefix);
          const match = re.exec(text);
          if (!match || match.index !== 0) continue;
          const invocationPrefix = match[0];
          const tail = text.slice(invocationPrefix.length).trim();
          const cargs = tail ? tail.split(/\s+/) : [];
          console.log(
            chalk.magenta(`🔍 customPrefix: «${invocationPrefix}» → ${plugName}`)
          );
          await invokeLoadedPlugin(plugName, cargs, invocationPrefix);
          return;
        }

        const beforeMsgBase = socketExtrasMod?.smsg
          ? sm
          : {
              ...msg,
              chat: chatId,
              sender: senderId,
              text,
              fromMe: !!msg?.key?.fromMe
            };

        for (const [plugName, plug] of commands) {
          if (!plug?.noPrefix || !plug.command || plug.command instanceof RegExp) continue;
          const list = Array.isArray(plug.command) ? plug.command : [plug.command];
          const matched = list.some(
            (a) => typeof a === "string" && a.toLowerCase() === trimmedLower
          );
          if (!matched) continue;
          console.log(chalk.magenta.bold(`\n🔍 [DEBUG] أمر بدون برفكس: ${trimmedLower} → ${plugName}\n`));
          await invokeLoadedPlugin(plugName, [], "");
          return;
        }

        const hooks = global.beforeHandlers || [];
        for (let i = 0; i < hooks.length; i++) {
          try {
            const consumed = await hooks[i](beforeMsgBase, {
              conn: sock,
              participants: undefined,
              groupMetadata: undefined
            });
            if (consumed === true) return;
          } catch (e) {
            console.error(chalk.red(`❌ before handler: ${e.message}`));
          }
        }

        return;
      }

      const args = text.slice(prefix.length).trim().split(/ +/);
      const cmd = args.shift().toLowerCase();

      let targetCmd = cmd;
      if (!commands.has(cmd) && aliases.has(cmd)) {
        targetCmd = aliases.get(cmd);
        console.log(chalk.blue(`🔗 تم تحويل alias: ${cmd} → ${targetCmd}`));
      } else if (!commands.has(cmd)) {
        for (const [name, plug] of commands) {
          const spec = plug.command;
          if (spec instanceof RegExp && spec.test(cmd)) {
            targetCmd = name;
            console.log(chalk.blue(`🔗 تطابق regex: ${cmd} → ${name}`));
            break;
          }
        }
      }

      console.log(chalk.magenta.bold(`\n🔍 [DEBUG] الأمر: ${cmd}`));
      console.log(chalk.magenta(`🔍 [DEBUG] المعاملات: ${args.join(" ") || "لا يوجد"}`));
      console.log(chalk.magenta(`🔍 [DEBUG] الأوامر: ${[...commands.keys()].join(", ")}`));
      console.log(chalk.magenta(`🔍 [DEBUG] Aliases: ${[...aliases.keys()].join(", ")}`));
      console.log(chalk.magenta(`🔍 [DEBUG] هل موجود؟ ${commands.has(targetCmd) ? "✅ نعم" : "❌ لا"}\n`));

      if (commands.has(targetCmd)) {
        await invokeLoadedPlugin(targetCmd, args, prefix);
      } else {
        console.log(chalk.gray(`⚠️ الأمر ${cmd} غير موجود`));
      }
    } catch (err) {
      console.error(chalk.red("❌ خطأ في معالجة الرسالة:"), err.message);
    }
  });

  sock.ev.on("group-participants.update", async (data) => {
    try {
      if (group) await group(sock, data);
      if (data?.participants && data?.action) {
        printGroupEvent(data.action, data.participants, data.author);
      }
    } catch (err) {
      console.error(chalk.red("❌ خطأ في حدث المجموعة:"), err.message);
    }
  });
}

setInterval(() => {
  try {
    const tmp = path.join(__dirname, "tmp");
    if (fs.existsSync(tmp))
      fs.readdirSync(tmp).forEach(f => {
        try { fs.unlinkSync(path.join(tmp, f)); } catch (e) {}
      });
  } catch (e) {}
}, 180000);
global.stopBotSystem = async (sock, reason = "manual", m = null) => {
  console.log(chalk.red.bold(`🛑 SHUTDOWN: ${reason}`));

  global.__shutdown = true;

  try {
    if (m?.chat) {
      await sock.sendMessage(m.chat, {
        text: "🛑 جاري إيقاف البوت بالكامل..."
      }, { quoted: m });
    }
  } catch {}

  try {
    await sock?.ws?.close();
  } catch {}

  try {
    sock?.ev?.removeAllListeners?.();
  } catch {}

  const id = setTimeout(() => {}, 0);
  for (let i = 0; i <= id; i++) {
    clearTimeout(i);
    clearInterval(i);
  }

  console.log("💀 BOT STOPPED COMPLETELY");

  process.exit(0);
};

global.restartBotSystem = async (sock, reason = "manual", m = null) => {
  console.log(chalk.yellow.bold(`🔄 RESTART: ${reason}`));

  global.__shutdown = false;
  global.__reconnectPending = true;

  try {
    if (m?.chat) {
      await sock.sendMessage(m.chat, {
        text: "🔄 جاري إعادة تشغيل البوت..."
      }, { quoted: m });
    }
  } catch {}

  try {
    await sock?.ws?.close();
  } catch {}

  try {
    sock?.ev?.removeAllListeners?.();
  } catch {}

  const id = setTimeout(() => {}, 0);
  for (let i = 0; i <= id; i++) {
    clearTimeout(i);
    clearInterval(i);
  }

  console.log("♻️ BOT RESTARTING...");

  process.exit(1);
};

process.on("uncaughtException",  (err) => {
  console.error(chalk.red("❌ خطأ غير متوقع:"), err.message);
  printError("uncaughtException", err);
});
process.on("unhandledRejection", (err) => {
  console.error(chalk.red("❌ رفض غير معالج:"), err?.message || err);
  printError("unhandledRejection", err);
});

startBot();
