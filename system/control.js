import fs from "fs";
import path from "path";
import axios from "axios"; // سيتم إضافته للتعامل مع تحميل الصور - تأكد من تثبيته: npm i axios

// دالة مساعدة لإرسال رسالة بصورة من رابط
async function sendWithImage(sock, jid, caption, imgUrl, options = {}) {
    try {
        // تحميل الصورة من الرابط
        const response = await axios.get(imgUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        
        await sock.sendMessage(jid, {
            image: buffer,
            caption: caption,
            ...options
        });
    } catch (err) {
        // في حال فشل تحميل الصورة، نرسل النص فقط
        console.error("Error sending image:", err.message);
        await sock.sendMessage(jid, { text: caption, ...options });
    }
}

const group = async (sock, data) => {
    try {
        if (!data?.participants) return null;
        
        const { id: chat, participants, action, author } = data;
        
        // تجاهل إذا كانت خاصية الترحيب معطلة في قاعدة البيانات
        if (global.db.groups[chat]?.noWelcome === true) return 9999;
        
        const participantsIds = participants.map(p => p.id || p);
        const participantsTags = participantsIds.map(id => '@' + id.split('@')[0]).join(' and ');
        const authorTag = author ? '@' + author.split('@')[0] : 'Unknown';
        
        let txt = "";
        let img = "https://files.catbox.moe/hm9iq4.jpg";
        
        switch(action) {
            case 'add':
                txt = `♡゙ مـنـور/ه ${participantsTags}${authorTag === participantsTags ? "" : `\n𝐛𝐲 ${authorTag}`}`;
                img = "https://files.catbox.moe/hm9iq4.jpg";
                break;
            case 'remove':
                txt = `${participantsTags} تم إزالته من الجروب${authorTag === participantsTags ? "" : `\n𝐛𝐲 ${authorTag}`}`;
                img = "https://files.catbox.moe/hm9iq4.jpg";
                break;
            case 'promote':
                txt = `♡゙ مـبـروك الادمـن ${participantsTags}\nby ${authorTag}`;
                img = "https://files.catbox.moe/hm9iq4.jpg";
                break;
            case 'demote':
                txt = `♡゙ بـقـيـت عـضـو خـلاص ${participantsTags}\nby ${authorTag}`;
                img = "https://files.catbox.moe/hm9iq4.jpg";
                break;
            default:
                return null;
        }
        
        // إعداد mentions
        const mentions = [];
        if (author) mentions.push(author);
        mentions.push(...participantsIds);
        
        // إرسال الرسالة مع الصورة
        await sendWithImage(sock, chat, txt, img, {
            mentions: mentions,
            contextInfo: {
                mentionedJid: mentions
            }
        });
        
    } catch (e) {
        console.error("Error in group event:", e);
    }
    return null;
};

// دالة access: ترسل رسالة خطأ محددة حسب type
const access = async (sock, msg, checkType, time = null) => {
    const chat = msg.key.remoteJid;
    const quoted = msg; // الاقتباس اختياري
    
    const messages = {
        cooldown: `*♡⏳ استنى ${time || 'بعض كام ثانيه'} ثانية وكمل الأمر ⏳♡*\n⊱⋅ ──────────── ⋅⊰\n> *_لازم تصبر شويه عشان الأمر ده مينفعش فيه الاسبام_*`,
        owner: `*♡ 🇩🇪 الأمر ده لـ المطورين فقط 🇩🇪♡*\n⊱⋅ ──────────── ⋅⊰\n> *_الامر ده لـ المطورين البوت لازم تكون مطور عشان تقدر تستخدمه_`,
        group: `*♡💠 الأمر ده بيشتغل بس ف الجروبات 💠♡*\n⊱⋅ ──────────── ⋅⊰\n> *_لازم الأمر ده تستخدمه ف جروب فقط ممنوع غير كده_*`,
        admin: `*♡📯 الأمر ده لـ الادمن فقط 📯♡*\n⊱⋅ ──────────── ⋅⊰\n> *_انت مجرد عضو لازم تبقي ادمن يا عضو يا عبد_*`,
        private: `*♡🏷️ الأمر ده في الخاص فقط 🏷️♡*\n⊱⋅ ──────────── ⋅⊰\n> *_الامر ف الخاص بس ياحبيبي_*`,
        botAdmin: `*♡📌 لازم اكون ادمن عشان انقذ الأمر 📌♡*\n⊱⋅ ──────────── ⋅⊰\n> *_حطني ادمن عشان تقدر تستعمل الأمر ده_*`,
        noSub: `*♡🫒 الأمر ده ف البوت الأساسي فقط 🫒♡*\n⊱⋅ ──────────── ⋅⊰\n> *_ادخل الجروب ده و جرب الأمر [ https://chat.whatsapp.com/Epfd9J7t8tR6nnpIDjtGQZ?mode=gi_t ] ياريت من غير سبام_*`,
        disabled: `*♡🗃️ الامر متوقف (تحت صيانة) 🗃️♡*\n⊱⋅ ──────────── ⋅⊰\n> *_الامر تحت صيانه قريباً بيشتغل تاني_*`,
        error: `*♡❌ الأمر فيه خطأ، كلم المطورين ❌♡*\n⊱⋅ ──────────── ⋅⊰\n*_اكتب " .المطور " عشان يبعتلك رقم المطور_*`
    };
    
    if (!messages[checkType]) return null;
    
    const img = "https://i.pinimg.com/originals/02/c3/51/02c351dfd4eb72a62f225ce964dc510d.jpg";
    
    // إرسال رسالة الخطأ مع الصورة (أو بدونها إذا فشل)
    await sendWithImage(sock, chat, messages[checkType], img, {
        quoted: quoted
    });
    
    return false;
};

export { access, group };
