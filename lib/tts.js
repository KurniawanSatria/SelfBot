const API_KEY = process.env.FISH_APIKEY || "";
const VOICE_ID = process.env.FISH_VOICE_ID || "8a62f569b9e54dda88dad8560635a4ad";
const MODEL = process.env.FISH_TTS_MODEL || "s2-pro";
const TIMEOUT = Number(process.env.TTS_TIMEOUT_MS || 30000);
const MAX_CHARS = 500;

function isReady() {
  return Boolean(API_KEY && VOICE_ID);
}

async function synthesize(text) {
  const value = String(text || "").trim().slice(0, MAX_CHARS);
  if (!value) throw new Error("Empty text");
  if (!API_KEY) throw new Error("FISH_APIKEY is not set");
  if (!VOICE_ID) throw new Error("FISH_VOICE_ID is not set");

  const res = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      model: MODEL,
    },
    body: JSON.stringify({ text: value, reference_id: VOICE_ID, format: "mp3" }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) {
    throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("TTS returned empty audio");
  return buffer;
}

module.exports = { synthesize, isReady };
