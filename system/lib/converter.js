import { promises } from "fs";
import { join, dirname } from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function ffmpeg(buffer, args = [], ext = "", ext2 = "") {
  return new Promise((resolve, reject) => {
    const tmp = join(__dirname, "..", "tmp", `${Date.now()}.${ext}`);
    const out = `${tmp}.${ext2}`;

    promises
      .writeFile(tmp, buffer)
      .then(() => {
        const child = spawn("ffmpeg", ["-y", "-i", tmp, ...args, out]);
        child.on("error", reject);
        child.on("close", async (code) => {
          try {
            await promises.unlink(tmp).catch(() => {});
            if (code !== 0) return reject(new Error(`ffmpeg exit ${code}`));
            const data = await promises.readFile(out);
            resolve({
              data,
              filename: out,
              delete() {
                return promises.unlink(out).catch(() => {});
              }
            });
          } catch (e) {
            reject(e);
          }
        });
      })
      .catch(reject);
  });
}

function toPTT(buffer, ext) {
  return ffmpeg(
    buffer,
    ["-vn", "-c:a", "libopus", "-b:a", "128k", "-vbr", "on"],
    ext,
    "ogg"
  );
}

function toAudio(buffer, ext) {
  return ffmpeg(
    buffer,
    [
      "-vn",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-vbr",
      "on",
      "-compression_level",
      "10"
    ],
    ext,
    "opus"
  );
}

function toVideo(buffer, ext) {
  return ffmpeg(
    buffer,
    [
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-ab",
      "128k",
      "-ar",
      "44100",
      "-crf",
      "32",
      "-preset",
      "slow"
    ],
    ext,
    "mp4"
  );
}

export { toAudio, toPTT, toVideo, ffmpeg };
