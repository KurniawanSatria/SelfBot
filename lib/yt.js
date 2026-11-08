const fs = require("fs");
const { createDecipheriv } = require("node:crypto");

const ST_KEY = Buffer.from("C5D58EF67A7584E4A29F6C35BBC4EB12", "hex");
const ST_HEADERS = {
  accept: "*/*",
  "content-type": "application/json",
  origin: "https://save-tube.com",
  referer: "https://save-tube.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/133.0.0.0 Safari/537.36",
};
const AUDIO_QUALITY = process.env.YT_AUDIO_QUALITY || "128";
const VIDEO_QUALITY = process.env.YT_VIDEO_QUALITY || "720";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function savetubeInfo(videoUrl) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const cdn = (await (await fetch("https://media.savetube.vip/api/random-cdn", { headers: ST_HEADERS, signal: AbortSignal.timeout(15000) })).json()).cdn;
      const infoJson = await (await fetch(`https://${cdn}/v2/info`, { method: "POST", headers: ST_HEADERS, body: JSON.stringify({ url: videoUrl }), signal: AbortSignal.timeout(20000) })).json();
      if (!infoJson?.data) throw new Error("empty info");
      const buf = Buffer.from(infoJson.data, "base64");
      const d = createDecipheriv("aes-128-cbc", ST_KEY, buf.subarray(0, 16));
      const dec = JSON.parse(Buffer.concat([d.update(buf.subarray(16)), d.final()]).toString());
      return { cdn, dec };
    } catch (err) {
      lastErr = err;
      if (i < 2) await sleep(2000);
    }
  }
  throw lastErr;
}

async function savetubeDownload(cdn, dec, downloadType, quality) {
  let lastErr;
  for (let i = 0; i < 10; i++) {
    try {
      const dl = await (await fetch(`https://${cdn}/download`, { method: "POST", headers: ST_HEADERS, body: JSON.stringify({ id: dec.id, downloadType, quality, key: dec.key }), signal: AbortSignal.timeout(30000) })).json();
      if (dl?.data?.downloadUrl) return dl.data.downloadUrl;
      throw new Error(dl?.message || "no downloadUrl");
    } catch (err) {
      lastErr = err;
      if (i < 9) await sleep(/busy/i.test(err.message) ? 8000 : 3000);
    }
  }
  throw lastErr;
}

async function resolve(url, type, quality) {
  const { cdn, dec } = await savetubeInfo(url);
  const download_url = await savetubeDownload(cdn, dec, type, quality);
  return { download_url, title: dec.title, mime: type === "audio" ? "audio/mpeg" : "video/mp4" };
}

const downloadMP3 = (url) => resolve(url, "audio", AUDIO_QUALITY);
const downloadMP4 = (url) => resolve(url, "video", VIDEO_QUALITY);

function cleanupLocal(filePath) {
  if (!filePath) return;
  try { fs.rmSync(filePath, { force: true }); } catch {}
}

module.exports = { downloadMP3, downloadMP4, cleanupLocal, savetubeInfo, savetubeDownload };
