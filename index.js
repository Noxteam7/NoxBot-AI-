import { group, access } from "./system/control.js";
import UltraDB from "./system/UltraDB.js";
import sub from "./sub.js";

// قاعدة البيانات
if (!global.db) {
  global.db = new UltraDB();
}

// الإعدادات العامة
export const config = {
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

export { group, access, sub };
