const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const sharp = require("sharp");
const { Image } = require("node-webpmux");
const { getRandom } = require("./helper");

const execFileP = promisify(execFile);

async function addExif(webpPath, { packname = "", author = "" } = {}) {
  const img = new Image();
  await img.load(webpPath);
  const json = Buffer.from(
    JSON.stringify({
      "sticker-pack-id": crypto.randomBytes(32).toString("hex"),
      "sticker-pack-name": packname,
      "sticker-pack-publisher": author,
      emojis: ["🤖"],
    }),
    "utf-8",
  );
  const exif = Buffer.concat([
    Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]),
    json,
  ]);
  exif.writeUInt32LE(json.length, 14);
  img.exif = exif;
  const out = getRandom(".webp");
  await img.save(out);
  fs.rmSync(webpPath, { force: true });
  return out;
}

async function writeExifImg(input, opts = {}) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const webp = await sharp(buf)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 80 })
    .toBuffer();
  const tmp = getRandom(".webp");
  fs.writeFileSync(tmp, webp);
  return addExif(tmp, opts);
}

async function writeExifVid(input, opts = {}) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const src = getRandom(".mp4");
  fs.writeFileSync(src, buf);
  const tmp = getRandom(".webp");
  try {
    await execFileP("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-i", src,
      "-vcodec", "libwebp", "-vf", "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=0x00000000",
      "-lossless", "0", "-compression_level", "6", "-q:v", "60", "-loop", "0", "-an", "-vsync", "0", tmp,
    ]);
    return await addExif(tmp, opts);
  } finally {
    fs.rmSync(src, { force: true });
  }
}

module.exports = { writeExifImg, writeExifVid };
