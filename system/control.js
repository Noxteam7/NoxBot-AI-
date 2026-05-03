import axios from "axios";
import { config } from "../index.js";

// دالة بناء contextInfo (معاد توجيه + رد خارجي)
const buildContext = (jid, thumbnailUrl, title = "|𝐁𝐨𝐭 𝐢𝐬 𝐛𝐮𝐢𝐥𝐭 𝐨𝐧 𝐭𝐡𝐞 𝐖𝐒 𝐟𝐫𝐚𝐦𝐞𝐰𝐨𝐫𝐤", body = "Hidden System") => ({
    mentionedJid: [jid],
    isForwarded: true,
    forwardingScore: 1,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363425878747150@newsletter',
        newsletterName: '✮⋆˙⦓  🍓⃝ᒍᗩ᙭ ᑕᕼᗩᑎᑎᒪ ⦔˙⋆✮',
        serverMessageId: 0
    },
    externalAdReply: {
        title: title,
        body: body,
        thumbnailUrl: thumbnailUrl,
        sourceUrl: '',
        mediaType: 1,
        renderLargerThumbnail: true
    }
});

// إرسال رسالة بصورة مع context اختياري
async function sendWithImage(sock, jid, caption, imgUrl, options = {}) {
    try {
        const response = await axios.get(imgUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        let contextInfo = options.contextInfo;
        if (!contextInfo && jid) {
            contextInfo = buildContext(jid, imgUrl, config.info.nameBot, "NoxBot");
        }
        await sock.sendMessage(jid, {
            image: buffer,
            caption: caption,
            mentions: options.mentions || [],
            contextInfo: contextInfo
        });
    } catch (err) {
        let contextInfo = options.contextInfo || buildContext(jid, config.images[0], config.info.nameBot, "NoxBot");
        await sock.sendMessage(jid, {
            text: caption,
            mentions: options.mentions || [],
            contextInfo: contextInfo
        });
    }
}

// أحداث المجموعة
export const group = async (sock, data) => {
    try {
        if (!data?.participants) return;
        const { id: chat, participants, action, author } = data;
        if (global.db.groups[chat]?.noWelcome === true) return;

        const participantsIds = participants.map(p => p.id || p);
        const participantsTags = participantsIds.map(id => '@' + id.split('@')[0]).join(' and ');
        const authorTag = author ? '@' + author.split('@')[0] : 'Unknown';
        
        let txt = "";
        switch(action) {
            case 'add': txt = `♡゙ مـنـور/ه ${participantsTags}${authorTag === participantsTags ? "" : `\n𝐛𝐲 ${authorTag}`}`; break;
            case 'remove': txt = `${participantsTags} تم إزالته من الجروب${authorTag === participantsTags ? "" : `\n𝐛𝐲 ${authorTag}`}`; break;
            case 'promote': txt = `♡゙ مـبـروك الادمـن ${participantsTags}\nby ${authorTag}`; break;
            case 'demote': txt = `♡゙ بـقـيـت عـضـو خـلاص ${participantsTags}\nby ${authorTag}`; break;
            default: return;
        }
        const mentions = [...(author ? [author] : []), ...participantsIds];
        const randomImg = config.images[Math.floor(Math.random() * config.images.length)];
        await sendWithImage(sock, chat, txt, randomImg, { mentions });
    } catch (e) { console.error(e); }
};

// رسائل الأخطاء والصلاحيات
export const access = async (sock, msg, checkType, time = null) => {
    const chat = msg.key.remoteJid;
    const messages = {
        cooldown: `*♡⏳ استنى ${time || 'بعض كام ثانيه'} ثانية وكمل الأمر ⏳♡*`,
        owner: `*♡ 🇩🇪 الأمر ده لـ المطورين فقط 🇩🇪♡*`,
        group: `*♡💠 الأمر ده بيشتغل بس ف الجروبات 💠♡*`,
        admin: `*♡📯 الأمر ده لـ الادمن فقط 📯♡*`,
        private: `*♡🏷️ الأمر ده في الخاص فقط 🏷️♡*`,
        botAdmin: `*♡📌 لازم اكون ادمن عشان انقذ الأمر 📌♡*`,
        noSub: `*♡🫒 الأمر ده ف البوت الأساسي فقط 🫒♡*`,
        disabled: `*♡🗃️ الامر متوقف (تحت صيانة) 🗃️♡*`,
        error: `*♡❌ الأمر فيه خطأ، كلم المطورين ❌♡*`
    };
    if (!messages[checkType]) return;
    const randomImg = config.images[Math.floor(Math.random() * config.images.length)];
    await sendWithImage(sock, chat, messages[checkType], randomImg, { quoted: msg });
};
