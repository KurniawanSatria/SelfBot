const API_KEY = process.env.FISH_APIKEY || "";
const MODEL = process.env.FISH_ASR_MODEL || "transcribe-1-pro";
const TIMEOUT = Number(process.env.STT_TIMEOUT_MS || 120000);
const MAX_BYTES = Number(process.env.STT_MAX_BYTES || 25 * 1024 * 1024);

function isReady() {
  return Boolean(API_KEY);
}

async function transcribe(audio) {
  if (!Buffer.isBuffer(audio) || !audio.length) throw new Error("audio is empty");
  if (audio.length > MAX_BYTES) throw new Error("audio is too large");
  if (!API_KEY) throw new Error("FISH_APIKEY is not set");
  const form = new FormData();
  form.append("audio", new Blob([audio]), "voice.ptt");
  form.append("ignore_timestamps", "true");
  const res = await fetch("https://api.fish.audio/v1/asr", {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, model: MODEL },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`ASR HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  const text = String(data.text || "").trim();
  if (!text) throw new Error("no speech found");
  return text;
}

module.exports = { transcribe, isReady };
