import { group, access, sendWithImage } from "./system/control.js";
import UltraDB from "./system/UltraDB.js";
import sub from "./system/sub.js";

if (!global.db) {
  global.db = new UltraDB();
}

export const config = {
  phoneNumber: "212645456872",
  prefix: [".", "/", "!"," "],
  owners: [
    { name: "escanor", jid: "212727621948@s.whatsapp.net" },
    { name: "mix", jid: "33760509044@s.whatsapp.net" },
    { name: "Duke", jid: "966547540321@s.whatsapp.net" }
  ],
  commandsPath: "./plugins",
  info: {
    nameBot: "𝐍𝐨𝐱𝐁𝐨𝐭-𝐀𝐈",
    nameChannel: "☆🌙 𝐍𝐎𝐗𝟕 </> 𝐂𝐡𝐚𝐧𝐧𝐞𝐥☆",
  },
  images: [
    "https://i.pinimg.com/originals/11/26/97/11269786cdb625c60213212aa66273a9.png",
    "https://i.pinimg.com/originals/e2/21/20/e221203f319df949ee65585a657501a2.jpg",
    "https://i.pinimg.com/originals/bb/77/0f/bb770fad66a634a6b3bf93e9c00bf4e5.jpg"
  ]
};

global.randomchannelName = "☆🌙 𝐍𝐎𝐗𝟕 </> 𝐂𝐡𝐚𝐧𝐧𝐞𝐥☆";
global.randomchannelId = "120363425878747150@newsletter";


global.packname = "𝐍𝐨𝐱𝐁𝐨𝐭-𝐀𝐈";
global.author = "@Nox7team";

global.fingerprint = [
  "محمد الدوق كان هنا ياض يا ملزق منك له ",
  "اسكانور كان هنا ياض يا ملزق منك له ",
  "ميكس كان هنا ياض يا ملزق منك له ",
  "دوكر كان هنا ياض يا ملزق منك له ",
];

global.getfingerprint = function () { 
  return global.fingerprint[Math.floor(Math.random() * global.fingerprint.length)];
};

export { group, access, sendWithImage, sub };
