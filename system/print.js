import chalk from "chalk";
import os from "os";
import { execSync } from "child_process";

function getRealJid(msg) {
  let jid =
    msg.key?.remoteJid ||
    msg.key?.participant ||
    msg.key?.id ||
    "unknown";

  if (
    jid === "status@broadcast" &&
    msg.message?.newsletterMessageInfo?.newsletterJid
  ) {
    jid = msg.message.newsletterMessageInfo.newsletterJid;
  }

  return jid;
}

function getChatType(jid) {
  if (!jid) return "Unknown";

  if (jid.endsWith("@g.us")) return "Group 👥";
  if (jid.includes("@newsletter")) return "Channel 📢";
  if (jid.includes("@broadcast")) return "Broadcast 📡";
  return "Private 👤";
}

function getSystemInfo() {
  const totalMem = os.totalmem() / (1024 ** 3);
  const freeMem = os.freemem() / (1024 ** 3);
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || "Unknown";
  const cpuCores = cpus.length;

  let diskTotal = 0, diskUsed = 0;
  try {
    const df = execSync("df -BG / | tail -1 | awk '{print $2, $3}'")
      .toString()
      .trim();
    const [total, used] = df.split(" ").map(v => parseFloat(v.replace("G", "")));
    diskTotal = total || 0;
    diskUsed = used || 0;
  } catch {}

  return {
    ramUsed: usedMem.toFixed(2),
    ramTotal: totalMem.toFixed(2),
    cpu: `${cpuModel} (${cpuCores} cores)`,
    diskUsed: diskUsed.toFixed(2),
    diskTotal: diskTotal.toFixed(2)
  };
}

function getFormattedTime() {
  const now = new Date();
  return {
    date: now.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }),
    time: now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  };
}

function getSenderName(msg) {
  return msg.pushName || msg.key?.participant?.split("@")[0] || "User";
}

async function getChatName(sock, jid) {
  try {
    if (jid.endsWith("@g.us")) {
      const meta = await sock.groupMetadata(jid).catch(() => null);
      return meta?.subject || "Group";
    }

    if (jid.includes("@newsletter")) {
      return "Channel";
    }

    return "Private";
  } catch {
    return jid.split("@")[0];
  }
}

export async function printIncomingMessage(sock, msg, text, cmd = null, args = []) {
  const sender = getRealJid(msg);
  const pushName = getSenderName(msg);
  const chatName = await getChatName(sock, sender);
  const chatType = getChatType(sender);

  const { date, time } = getFormattedTime();
  const sys = getSystemInfo();

  const lines = [
    "",
    chalk.yellow("╔══════════════════════════════════════════════════════════╗"),
    chalk.yellow("║") + "  " + chalk.cyan.bold("📥 Incoming Message") + "                              " + chalk.yellow("║"),
    chalk.yellow("╠══════════════════════════════════════════════════════════╣"),

    chalk.yellow("║") + "  " + chalk.green.bold(`📩 From: ${pushName}`) + "         " + chalk.yellow("║"),
    chalk.yellow("║") + "  " + chalk.white(`🆔 ID: ${sender}`) + "        " + chalk.yellow("║"),
    chalk.yellow("║") + "  " + chalk.blue(`📊 Type: ${chatType}`) + "        " + chalk.yellow("║"),
    chalk.yellow("║") + "  " + chalk.white(`💬 Chat: ${chatName}`) + "                                " + chalk.yellow("║"),
    chalk.yellow("║") + "  " + chalk.white(`📝 Text: ${text || "(No text)"}`) + "                       " + chalk.yellow("║"),
  ];

  if (cmd) {
    lines.push(
      chalk.yellow("║") + "  " + chalk.magenta.bold(`🎯 Command: ${cmd}`) + "                           " + chalk.yellow("║"),
      chalk.yellow("║") + "  " + chalk.blue(`📦 Args: ${args.length > 0 ? args.join(" ") : "None"}`) + "             " + chalk.yellow("║")
    );
  }

  lines.push(
    chalk.yellow("║") + "  " + chalk.gray(`📅 ${date} | ⏰ ${time}`) + "                 " + chalk.yellow("║"),
    chalk.yellow("╠══════════════════════════════════════════════════════════╣"),
    chalk.yellow("║") + "  " + chalk.green(`🤖 ${global.config?.info?.nameBot || "NOXBOT"}`) +
      " | " +
      chalk.green(`RAM: ${sys.ramUsed}GB/${sys.ramTotal}GB`) +
      "   " + chalk.yellow("║"),
    chalk.yellow("╚══════════════════════════════════════════════════════════╝"),
    ""
  );

  console.log(lines.join("\n"));
}

export async function printOutgoingMessage(sock, jid, text, type = "text") {
  const chatType = getChatType(jid);

  const chatName = jid.endsWith("@g.us")
    ? (await sock.groupMetadata(jid).catch(() => ({ subject: "Group" }))).subject
    : jid.includes("@newsletter")
    ? "Channel"
    : "Private";

  const { date, time } = getFormattedTime();
  const sys = getSystemInfo();

  const iconMap = {
    text: "📤",
    image: "🖼️",
    video: "🎥",
    audio: "🎵",
    document: "📄",
    sticker: "🎭"
  };

  const lines = [
    "",
    chalk.cyan("╔══════════════════════════════════════════════════════════╗"),
    chalk.cyan("║") + "  " + chalk.green.bold(`${iconMap[type] || "📤"} Outgoing Message`) + "         " + chalk.cyan("║"),
    chalk.cyan("╠══════════════════════════════════════════════════════════╣"),

    chalk.cyan("║") + "  " + chalk.yellow.bold(`📩 To: ${chatName}`) + "       " + chalk.cyan("║"),
    chalk.cyan("║") + "  " + chalk.white(`🆔 ID: ${jid}`) + "        " + chalk.cyan("║"),
    chalk.cyan("║") + "  " + chalk.blue(`📊 Type: ${chatType}`) + "        " + chalk.cyan("║"),
    chalk.cyan("║") + "  " + chalk.white(`📝 Text: ${text || "(No text)"}`) + "                       " + chalk.cyan("║"),
    chalk.cyan("║") + "  " + chalk.gray(`📅 ${date} | ⏰ ${time}`) + "                 " + chalk.cyan("║"),

    chalk.cyan("╠══════════════════════════════════════════════════════════╣"),
    chalk.cyan("║") + "  " + chalk.green(`🤖 ${global.config?.info?.nameBot || "NOXBOT"}`) +
      " | " +
      chalk.green(`RAM: ${sys.ramUsed}GB/${sys.ramTotal}GB`) +
      "   " + chalk.cyan("║"),
    chalk.cyan("╚══════════════════════════════════════════════════════════╝"),
    ""
  ];

  console.log(lines.join("\n"));
}

export function printCommandExecution(cmd, status = "success", details = "") {
  const statusIcon =
    status === "success" ? "✅" :
    status === "error" ? "❌" : "⚡";

  const statusColor =
    status === "success" ? chalk.green :
    status === "error" ? chalk.red :
    chalk.yellow;

  console.log(
    chalk.white("  ") +
    statusColor.bold(
      `${statusIcon} ${status === "success"
        ? "Executed"
        : status === "error"
        ? "Failed"
        : "Running"} command ${cmd} ${details ? "- " + details : ""}`
    )
  );
  console.log("");
}

export function printGroupEvent(action, participants, author = null) {
  const actionMap = {
    add: { icon: "👋", text: "Joined", color: chalk.green },
    remove: { icon: "👋", text: "Left", color: chalk.red },
    promote: { icon: "⬆️", text: "Promoted", color: chalk.yellow },
    demote: { icon: "⬇️", text: "Demoted", color: chalk.red }
  };

  const info = actionMap[action] || {
    icon: "📌",
    text: action,
    color: chalk.white
  };

  const tags = participants.map(p => `@${p.split("@")[0]}`).join(" & ");
  const byTag = author ? ` by @${author.split("@")[0]}` : "";

  console.log("");
  console.log(info.color.bold(`${info.icon} Group Event: ${info.text} ${tags}${byTag}`));
  console.log("");
}

export function printSystemInfo() {
  const sys = getSystemInfo();
  const { date, time } = getFormattedTime();

  console.log("");
  console.log(chalk.magenta("╔══════════════════════════════════════════════════════════╗"));
  console.log(chalk.magenta("║") + "  " + chalk.cyan.bold("🖥️ System Information") + "          " + chalk.magenta("║"));
  console.log(chalk.magenta("╠══════════════════════════════════════════════════════════╣"));
  console.log(chalk.magenta("║") + "  " + chalk.white(`💾 RAM: ${sys.ramUsed}GB / ${sys.ramTotal}GB`) + "       " + chalk.magenta("║"));
  console.log(chalk.magenta("║") + "  " + chalk.white(`🧠 CPU: ${sys.cpu}`) + "         " + chalk.magenta("║"));
  console.log(chalk.magenta("║") + "  " + chalk.white(`💽 Storage: ${sys.diskUsed}GB / ${sys.diskTotal}GB`) + "   " + chalk.magenta("║"));
  console.log(chalk.magenta("║") + "  " + chalk.gray(`📅 ${date} | ⏰ ${time}`) + "                 " + chalk.magenta("║"));
  console.log(chalk.magenta("╚══════════════════════════════════════════════════════════╝"));
  console.log("");
}

export function printError(context, error) {
  console.log("");
  console.log(chalk.red("╔══════════════════════════════════════════════════════════╗"));
  console.log(chalk.red("║") + "  " + chalk.red.bold("❌ Error") + "                           " + chalk.red("║"));
  console.log(chalk.red("╠══════════════════════════════════════════════════════════╣"));
  console.log(chalk.red("║") + "  " + chalk.white(`📍 Context: ${context}`) + "              " + chalk.red("║"));
  console.log(chalk.red("║") + "  " + chalk.white(`💬 Message: ${error?.message || error}`) + "     " + chalk.red("║"));
  console.log(chalk.red("╚══════════════════════════════════════════════════════════╝"));
  console.log("");
}

export default {
  printIncomingMessage,
  printOutgoingMessage,
  printCommandExecution,
  printGroupEvent,
  printSystemInfo,
  printError
};
