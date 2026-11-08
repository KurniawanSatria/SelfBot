const PREFIX = process.env.PREFIX || ".";
const BASE_URL = (process.env.OPENAI_BASE_URL || "https://9router.saturia.codes/v1").replace(/\/+$/, "");
const API_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "Coding";
const SYSTEMONE_URL = process.env.SYSTEMONE_URL || "https://9router.saturia.codes/v1/systemone";
const SYSTEMONE_KEY = process.env.SYSTEMONE_KEY || process.env.OPENAI_API_KEY || "";
const SYSTEMONE_MODEL = process.env.SYSTEMONE_MODEL || "cf/@cf/cloudflare/clef-flash";
const DECISION_THRESHOLD = Number(process.env.AI_DECISION_THRESHOLD || 0.5);
const TIMEOUT = Number(process.env.AI_TIMEOUT_MS || 60000);
const ENABLED = process.env.AI_DM !== "false";
const COOLDOWN_MS = Number(process.env.AI_DM_COOLDOWN_MS || 4000);
const MAX_HISTORY = Number(process.env.AI_HISTORY || 10);
const MAX_CONTEXT = Number(process.env.AI_CONTEXT || 6);
const MAX_CHATS = 2000;

const history = new Map();
const lastReply = new Map();

function isDm(m) {
  if (!m?.isPrivate || m.fromMe) return false;
  const chat = m.chat || "";
  if (!chat || chat === "status@broadcast" || chat.endsWith("@broadcast") || chat.endsWith("@newsletter")) return false;
  return true;
}

function botKnowledge() {
  const mods = [...new Set(global.commands.values())]
    .filter((x) => x?.name)
    .sort((a, b) => String(a.category || "Other").localeCompare(String(b.category || "Other")) || a.name.localeCompare(b.name));
  const lines = [];
  let cat = null;
  for (const m of mods) {
    if (m.category !== cat) {
      cat = m.category;
      lines.push(`\n[${cat || "Other"}]`);
    }
    const al = (m.aliases || []).length ? ` (alias: ${m.aliases.map((a) => PREFIX + a).join(", ")})` : "";
    lines.push(`- ${PREFIX}${m.name}${al}: ${m.description || "-"}`);
  }
  return lines.join("\n").trim();
}

function botFacts() {
  return [
    `Bot name: ${process.env.STICKER_PACKNAME || "Shiroko Md"}.`,
    `Command prefix: "${PREFIX}". Example: ${PREFIX}menu.`,
    `Owner: ${(process.env.OWNER_NUMBER || "").split(",").map((s) => s.trim()).filter(Boolean).join(", ") || "-"}.`,
    `Automatic features: TikTok/Instagram/Twitter link downloads, anti-delete messages, automatic call rejection, and user statistics.`,
    `The bot only runs commands that start with the prefix "${PREFIX}".`,
  ].join("\n");
}

function systemAnswer() {
  return [
    `You are ${process.env.STICKER_PACKNAME || "Shiroko Md"}, a friendly, casual, and concise WhatsApp assistant that speaks English (maximum ~4 sentences).`,
    "",
    "You must fully understand this bot. Bot facts:",
    botFacts(),
    "",
    "List of ALL available commands:",
    botKnowledge(),
    "",
    "Rules:",
    `- Only answer questions about this bot. Do not invent commands or features that are not listed.`,
    `- If the user is confused, direct them to the appropriate command or ${PREFIX}menu.`,
    `- If something is beyond the bot's capabilities, say so and offer ${PREFIX}menu.`,
    "- Do not mention being an AI/model; answer as the bot.",
  ].join("\n");
}

function decideInstructions() {
  const cmds = [...new Set([...global.commands.values()].filter((x) => x?.name).map((x) => PREFIX + x.name))].join(", ");
  return [
    `Kamu triage bot WhatsApp "${process.env.STICKER_PACKNAME || "Shiroko Md"}". Bot merespons command berprefix "${PREFIX}".`,
    `Daftar command: ${cmds || "-"}.`,
    "The state contains conversation context; the last line is the user message to evaluate.",
    "Decide whether the bot should reply to the last DIRECT message with AI.",
    "Use HIGH when the user is confused or needs help; asks about the bot, usage, features, or commands; mentions a command to try a feature; uses a command incorrectly; reports a bot error; or asks a short follow-up question/request.",
    "Use LOW for casual conversation, greetings, thanks, laughter, brief acknowledgements, spam, or messages that do not need the bot.",
  ].join(" ");
}

async function chat(messages, opts = {}) {
  if (!API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const body = {
    model: opts.model || MODEL,
    messages,
    max_tokens: opts.max_tokens ?? 1024,
    temperature: opts.temperature ?? 0.5,
  };
  if (process.env.AI_DISABLE_THINKING !== "false") body.chat_template_kwargs = { enable_thinking: false };
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  return String(msg?.content || "").trim();
}

async function decide(text, chat) {
  const t = String(text || "").trim();
  const first = t.replace(/^[.!/#$>]+\s*/, "").split(/\s+/)[0].toLowerCase();
  if (first && global.commands?.has(first)) return true;
  const res = await fetch(SYSTEMONE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SYSTEMONE_KEY}` },
    body: JSON.stringify({
      model: SYSTEMONE_MODEL,
      state: buildState(chat, t),
      questions: { should_reply: { type: "noul", instructions: decideInstructions() } },
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`systemone HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const answers = data.answers || data.result?.answers || {};
  const score = Number(answers.should_reply?.noul);
  return Number.isFinite(score) ? score >= DECISION_THRESHOLD : false;
}

async function answer(text, chatId) {
  return chat([{ role: "system", content: systemAnswer() }, ...contextOf(chatId, text), { role: "user", content: text }], { max_tokens: 1024, temperature: 0.5 });
}

function push(chat, role, content) {
  if (!chat || !content) return;
  const arr = history.get(chat) || [];
  const last = arr[arr.length - 1];
  if (last && last.role === role && last.content === content) return;
  arr.push({ role, content });
  while (arr.length > MAX_HISTORY) arr.shift();
  history.set(chat, arr);
  if (history.size > MAX_CHATS) history.delete(history.keys().next().value);
}

function note(chat, role, content) {
  push(chat, role, String(content || "").trim());
}

function contextOf(chat, text) {
  const arr = [...(history.get(chat) || [])];
  const last = arr[arr.length - 1];
  if (last && last.role === "user" && last.content === text) arr.pop();
  return arr.slice(-MAX_CONTEXT);
}

function buildState(chat, text) {
  const lines = contextOf(chat, text).map((h) => `${h.role === "user" ? "user" : "bot"}: ${h.content}`);
  lines.push(`user: ${text}`);
  return lines.join("\n");
}

function isCoolingDown(chat) {
  return Date.now() - (lastReply.get(chat) || 0) < COOLDOWN_MS;
}

function markReplied(chat) {
  lastReply.set(chat, Date.now());
  if (lastReply.size > MAX_CHATS) lastReply.delete(lastReply.keys().next().value);
}

async function maybeReply(sock, m) {
  if (!ENABLED || !isDm(m)) return false;
  const text = String(m.body || "").trim();
  if (!text || isCoolingDown(m.chat)) return false;
  let yes = false;
  try { yes = await decide(text, m.chat); } catch (e) { global.log?.warn?.(`AI decide error: ${e.message}`); return false; }
  if (!yes) return false;
  let out = null;
  try { out = await answer(text, m.chat); } catch (e) { global.log?.warn?.(`AI answer error: ${e.message}`); return false; }
  if (!out) return false;
  markReplied(m.chat);
  note(m.chat, "user", text);
  note(m.chat, "assistant", out);
  await m.reply(out);
  return true;
}

async function replyToError(sock, m, err) {
  if (!ENABLED || !isDm(m)) return false;
  if (isCoolingDown(m.chat)) return false;
  const text = `The bot just failed to process the user's request with this error: "${err?.message || err}". Briefly explain it politely and suggest a solution (or offer ${PREFIX}menu).`;
  let out = null;
  try { out = await answer(text, m.chat); } catch (e) { global.log?.warn?.(`AI error reply failed: ${e.message}`); return false; }
  if (!out) return false;
  markReplied(m.chat);
  note(m.chat, "assistant", out);
  await m.reply(out);
  return true;
}

module.exports = { decide, answer, maybeReply, replyToError, note, botKnowledge, isDm };
