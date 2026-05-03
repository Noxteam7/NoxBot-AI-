import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import axios from "axios";
import FormData from 'form-data';
import { fileTypeFromBuffer } from "file-type";
import { Sticker } from "wa-sticker-formatter";
import cheerio from "cheerio";

const execAsync = promisify(exec);
const tmp = path.join(process.cwd(), "tmp");

if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

/* ========== Create Sticker ======== */
/**
 * تحويل صورة أو فيديو إلى ملصق (ستيكر)
 * @param {Buffer} buffer - البيانا الخام للملف
 * @param {Object} options - خيارات إضافية { pack, author, quality, type }
 * @returns {Promise<Buffer>} - بيانات الستيكر النهائي
 */
const createSticker = async (buffer, options = {}) => {
  try {
    const sticker = new Sticker(buffer, {
      pack: options.pack || 'NoxBot-AI',
      author: options.author || 'NoxTeam7',
      type: options.type || "full",
      quality: options.mime === "image/jpg" ? 100 : 10
    });
    return await sticker.build();
  } catch (err) {
    throw new Error(`فشل إنشاء الملصق: ${err.message}`);
  }
};

/* ========== GIF TO MP4 ========= */
/**
 * تحويل رابط GIF إلى فيديو MP4 باستخدام ffmpeg
 * @param {string} url - رابط ملف الـ GIF
 * @returns {Promise<Buffer>} - بيانات فيديو MP4
 */
async function gifToMp4(url) {
  const id = Date.now();
  const gifPath = path.join(tmp, `${id}.gif`);
  const mp4Path = path.join(tmp, `${id}.mp4`);
  
  try {
    // تحميل الـ GIF
    const writer = fs.createWriteStream(gifPath);
    const res = await axios({ url, responseType: 'stream' });
    res.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    // تحويل باستخدام ffmpeg
    await execAsync(`ffmpeg -i "${gifPath}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p "${mp4Path}"`);
    
    const buffer = fs.readFileSync(mp4Path);
    return buffer;
  } finally {
    // تنظيف الملفات المؤقتة
    if (fs.existsSync(gifPath)) fs.unlinkSync(gifPath);
    if (fs.existsSync(mp4Path)) fs.unlinkSync(mp4Path);
  }
}

/* =========== CatBox Upload =========== */
/**
 * رفع ملف إلى خدمة catbox.moe
 * @param {Buffer} buffer - بيانات الملف
 * @returns {Promise<string>} - رابط التحميل المباشر
 */
async function uploadToCatbox(buffer) {
  const { ext, mime } = await fileTypeFromBuffer(buffer);
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', buffer, { filename: `${Date.now()}.${ext}`, contentType: mime });

  const { data } = await axios.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders() });
  if (!data?.includes('catbox')) throw new Error('فشل الرفع على Catbox');
  return data.trim();
}

/* =========== AI Chat (Pollinations) =========== */
/**
 * الدردشة مع الذكاء الاصطناعي (Pollinations.ai)
 * @param {Object} options - { text, model }
 * @returns {Promise<string>} - رد الذكاء الاصطناعي
 */
async function AiChat(options = {}) {
  const url = `https://text.pollinations.ai/${encodeURIComponent(options.text)}?model=${options.model || "openai"}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Pollinations API error: ${response.status}`);
  return response.text();
}

/* =========== Qu.ax Upload =========== */
const extractFromHtml = (html, baseUrl) => {
  const $ = cheerio.load(html);
  const selectors = [
    'meta[property="og:image"]', 'meta[property="og:video"]', 'meta[property="og:audio"]',
    'meta[name="twitter:image"]', 'meta[name="twitter:player"]', 'meta[name="twitter:video"]',
    'link[rel="image_src"]', 'link[rel="video_src"]', 'video source', 'audio source', 'img'
  ];
  
  for (const selector of selectors) {
    let url = $(selector).attr('content') || $(selector).attr('src') || $(selector).attr('href');
    if (url && !url.includes('base64') && !url.startsWith('data:')) {
      if (!url.startsWith('http')) {
        try { url = new URL(url, baseUrl).href; } catch(e) { continue; }
      }
      if (url.match(/\.(jpg|jpeg|png|gif|webp|mp4|mkv|webm|mov|mp3|wav|ogg|m4a|flac)(\?|$)/i)) return url;
    }
  }
  return null;
};

/**
 * رفع ملف إلى خدمة qu.ax
 * @param {Buffer} buffer - بيانات الملف
 * @returns {Promise<string>} - رابط الوسائط المباشر
 */
const uploadToQuax = async (buffer) => {
  const { ext, mime } = await fileTypeFromBuffer(buffer);
  const form = new FormData();
  form.append('files[]', buffer, { filename: `tmp.${ext}`, contentType: mime });
  const { data } = await axios.post('https://qu.ax/upload.php', form, { headers: form.getHeaders() });
  
  let mediaUrl = typeof data === 'string' ? extractFromHtml(data, 'https://qu.ax') : data.files?.[0]?.url;
  if (!mediaUrl) throw new Error('فشل الرفع على Qu.ax');
  if (mediaUrl.includes('/x/')) return mediaUrl;
  
  const { data: pageHtml } = await axios.get(mediaUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return extractFromHtml(pageHtml, mediaUrl) || mediaUrl;
};

/* =========== Utility: Download Media from WhatsApp =========== */
/**
 * تحميل ملف وسائط من رسالة واتساب (صورة، فيديو، صوت، مستند)
 * @param {Object} sock - اتصال Baileys
 * @param {Object} msg - رسالة الواتساب
 * @returns {Promise<Buffer>} - بيانات الملف
 */
async function downloadMedia(sock, msg) {
  let mediaMsg = msg.message?.imageMessage || 
                 msg.message?.videoMessage || 
                 msg.message?.audioMessage || 
                 msg.message?.documentMessage;
  if (!mediaMsg) throw new Error("لا توجد وسائط في هذه الرسالة");
  
  const stream = await sock.downloadMediaMessage(msg);
  return stream;
}

export { 
  uploadToCatbox, 
  uploadToQuax, 
  createSticker, 
  AiChat, 
  gifToMp4,
  downloadMedia
};
