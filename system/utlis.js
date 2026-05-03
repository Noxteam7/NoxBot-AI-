import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import axios from "axios";
import FormData from 'form-data';
import { fileTypeFromBuffer } from "file-type";
import cheerio from "cheerio";
import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';

const execAsync = promisify(exec);
const tmp = path.join(process.cwd(), "tmp");
if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

/* ========== Create Sticker using ffmpeg ======== */
const createSticker = async (buffer, options = {}) => {
  const inputPath = path.join(tmp, `${Date.now()}.png`);
  const outputPath = path.join(tmp, `${Date.now()}.webp`);
  
  // حفظ الصورة مؤقتاً
  fs.writeFileSync(inputPath, buffer);
  
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-vcodec', 'libwebp',
        '-lossless', '1',
        '-q:v', '70',
        '-preset', 'default',
        '-loop', '0',
        '-an',
        '-vsync', '0',
        '-s', '512x512'
      ])
      .output(outputPath)
      .on('end', () => {
        const stickerBuffer = fs.readFileSync(outputPath);
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
        resolve(stickerBuffer);
      })
      .on('error', (err) => {
        fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        reject(err);
      })
      .run();
  });
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

export { 
  uploadToCatbox, 
  uploadToQuax, 
  createSticker, 
  AiChat, 
  gifToMp4
};
