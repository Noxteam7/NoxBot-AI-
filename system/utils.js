import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import axios from "axios";
import FormData from 'form-data';
import { fileTypeFromBuffer } from "file-type";
import Sticker from 'wa-sticker-js';
import cheerio from "cheerio";

const execAsync = promisify(exec);
const tmp = path.join(process.cwd(), "tmp");

if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

/* ========== Create Sticker ======== */
const createSticker = async (buffer, options = {}) => {
  const sticker = new Sticker(buffer, {
    pack: options.pack || 'NoxBot-AI',
    author: options.author || 'NoxTeam7',
    quality: 80
  });
  return await sticker.toBuffer();
};

/* ========== GIF TO MP4 ========= */
async function gifToMp4(url) {
  const id = Date.now();
  const gifPath = path.join(tmp, `${id}.gif`);
  const mp4Path = path.join(tmp, `${id}.mp4`);
  
  const writer = fs.createWriteStream(gifPath);
  const res = await axios({ url, responseType: 'stream' });
  res.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  
  await execAsync(`ffmpeg -i "${gifPath}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p "${mp4Path}"`);
  
  const buffer = fs.readFileSync(mp4Path);
  fs.unlinkSync(gifPath);
  fs.unlinkSync(mp4Path);
  
  return buffer;
}

/* =========== CatBox Upload =========== */
async function uploadToCatbox(buffer) {
  const { ext, mime } = await fileTypeFromBuffer(buffer);
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', buffer, { filename: `${Date.now()}.${ext}`, contentType: mime });

  const { data } = await axios.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders() });
  if (!data?.includes('catbox')) throw new Error('upload failed');
  return data.trim();
}

/* =========== AI Chat =========== */
async function AiChat(options = {}) {
  const url = `https://text.pollinations.ai/${encodeURIComponent(options.text)}?model=${options.model || "openai"}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
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

const uploadToQuax = async (buffer) => {
  const { ext, mime } = await fileTypeFromBuffer(buffer);
  const form = new FormData();
  form.append('files[]', buffer, { filename: `tmp.${ext}`, contentType: mime });
  const { data } = await axios.post('https://qu.ax/upload.php', form, { headers: form.getHeaders() });
  
  let mediaUrl = typeof data === 'string' ? extractFromHtml(data, 'https://qu.ax') : data.files?.[0]?.url;
  if (!mediaUrl) throw new Error('Upload failed');
  if (mediaUrl.includes('/x/')) return mediaUrl;
  
  const { data: pageHtml } = await axios.get(mediaUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return extractFromHtml(pageHtml, mediaUrl) || mediaUrl;
};

/* =========== Download Media from WhatsApp =========== */
async function downloadMedia(sock, msg) {
  let mediaMsg = msg.message?.imageMessage || 
                 msg.message?.videoMessage || 
                 msg.message?.audioMessage || 
                 msg.message?.documentMessage;
  if (!mediaMsg) throw new Error("No media found");
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
