import axios from "axios";
import { config } from "../index.js";

export async function sendWithImage(sock, jid, caption, imgUrl, options = {}) {
  try {
    const res = await axios.get(imgUrl, {
      responseType: "arraybuffer",
      timeout: 10000
    });

    const buffer = Buffer.from(res.data, "binary");

    await sock.sendMessage(jid, {
      image: buffer,
      caption,
      mentions: options.mentions || []
    }, options.quoted ? { quoted: options.quoted } : {});

  } catch (err) {
    console.log("❌ sendWithImage error:", err.message);

    await sock.sendMessage(jid, {
      text: caption,
      mentions: options.mentions || []
    }, options.quoted ? { quoted: options.quoted } : {});
  }
}

export const group = async (sock, data) => {
  try {
    if (!data || !data.participants) return;

    const chat = data.id;
    const action = data.action;
    const participants = data.participants;
    const author = data.author;

    if (global.db?.groups?.[chat]?.noWelcome) return;

    const users = participants.map(v => v.id || v);

    let mentions = [];
    let textMentions = "";

    for (let user of users) {
      let number = user.split("@")[0];
      textMentions += `@${number} `;
      mentions.push(user);
    }

    let text = "";

    switch (action) {
      case "add":
        text = `♡ مرحبا ${textMentions}`;
        break;

      case "remove":
        text = `${textMentions} تم الخروج من الجروب`;
        break;

      case "promote":
        text = `♡ مبروك ${textMentions} صار أدمن`;
        break;

      case "demote":
        text = `♡ ${textMentions} تم تنزيله من الإدارة`;
        break;

      default:
        return;
    }

    if (author && !mentions.includes(author)) {
      mentions.push(author);
      let num = author.split("@")[0];
      text += `\n\nبواسطة @${num}`;
    }

    const randomImg = config.images[
      Math.floor(Math.random() * config.images.length)
    ];

    await sendWithImage(sock, chat, text.trim(), randomImg, {
      mentions
    });

  } catch (err) {
    console.log("❌ group error:", err);
  }
};

export const access = async (sock, msg, type, time = null) => {
  try {
    const chat = msg.key.remoteJid;
    const sender = msg.key.participant || chat;

    const senderTag = `@${sender.split("@")[0]}`;

    const messages = {
      cooldown: `⏳ ${senderTag} استنى ${time || "شوي"}`,
      owner: `🚫 ${senderTag} للمطور فقط`,
      group: `👥 ${senderTag} للجروبات فقط`,
      admin: `⭐ ${senderTag} للأدمن فقط`,
      private: `📩 ${senderTag} للخاص فقط`,
      botAdmin: `🤖 ${senderTag} لازم أكون أدمن`,
      disabled: `❌ ${senderTag} الأمر متوقف`
    };

    if (!messages[type]) return;

    const randomImg = config.images[
      Math.floor(Math.random() * config.images.length)
    ];

    await sendWithImage(sock, chat, messages[type], randomImg, {
      quoted: msg,
      mentions: [sender]
    });

  } catch (err) {
    console.log("❌ access error:", err);
  }
};

export async function sendWithMention(sock, jid, text, mentionJids = [], options = {}) {
  try {
    let finalText = text;

    for (let m of mentionJids) {
      let num = m.split("@")[0];
      if (!finalText.includes(`@${num}`)) {
        finalText += ` @${num}`;
      }
    }

    await sock.sendMessage(jid, {
      text: finalText.trim(),
      mentions: mentionJids
    }, options.quoted ? { quoted: options.quoted } : {});

  } catch (err) {
    console.log("❌ mention error:", err);
  }
      }
