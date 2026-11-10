const fs = require("fs");
const path = require("path");
const db = require("./database");

const MEMORY_LIMIT = Number(process.env.AI_MEMORY_LIMIT || 20);
const SKILLS_DIR = path.join(__dirname, "..", "skills");
const MAX_SKILL_CHARS = Number(process.env.AI_SKILL_MAX_CHARS || 4000);
const TRANSCRIPT_LIMIT = Number(process.env.AI_TRANSCRIPT_LIMIT || 100);
const TRANSCRIPT_MAX_TOTAL = Number(process.env.AI_TRANSCRIPT_TOTAL || 2000);
const OWNER_KEY = "__owner__";
const TRANSCRIPT_KEY = "__transcripts__";

const OWNER_FACTS = [
  "The account owner is Satria.",
  "He uses this assistant to ask questions and keep track of information about himself.",
  "Always write code in full English, including strings, comments, and UI text. Indonesian inside code strings feels odd to him.",
  "Reply to every chat in English only, never in Indonesian or any other language.",
];

function ensureStore() {
  if (!db.db?.data) return null;
  if (!db.db.data.aiMemory || typeof db.db.data.aiMemory !== "object") db.db.data.aiMemory = {};
  return db.db.data.aiMemory;
}

async function getFacts(chat) {
  await db.init();
  const store = ensureStore();
  if (!store) return [];
  return Array.isArray(store[chat]) ? store[chat] : [];
}

async function remember(chat, fact) {
  const value = String(fact || "").trim();
  if (!value) return null;
  await db.init();
  const store = ensureStore();
  if (!store) return null;
  const list = Array.isArray(store[chat]) ? store[chat] : [];
  if (list.includes(value)) return list;
  list.push(value);
  while (list.length > MEMORY_LIMIT) list.shift();
  store[chat] = list;
  await db.write();
  return list;
}

async function forget(chat, fact) {
  await db.init();
  const store = ensureStore();
  if (!store || !Array.isArray(store[chat])) return [];
  const wanted = String(fact || "").trim().toLowerCase();
  store[chat] = store[chat].filter((item) => item.toLowerCase() !== wanted);
  await db.write();
  return store[chat];
}

async function clearFacts(chat) {
  await db.init();
  const store = ensureStore();
  if (!store) return 0;
  const count = (store[chat] || []).length;
  delete store[chat];
  await db.write();
  return count;
}

async function clearTranscripts(chat) {
  await db.init();
  const store = ensureStore();
  if (!store || !store[TRANSCRIPT_KEY]) return 0;
  const count = (store[TRANSCRIPT_KEY][chat] || []).length;
  delete store[TRANSCRIPT_KEY][chat];
  await db.write();
  return count;
}

async function logTranscript(chat, role, content) {
  const value = String(content || "").trim();
  if (!value) return null;
  await db.init();
  const store = ensureStore();
  if (!store) return null;
  const all = store[TRANSCRIPT_KEY] && typeof store[TRANSCRIPT_KEY] === "object" ? store[TRANSCRIPT_KEY] : {};
  const list = Array.isArray(all[chat]) ? all[chat] : [];
  list.push({ role, content: value.slice(0, 4000), at: Date.now() });
  while (list.length > TRANSCRIPT_LIMIT) list.shift();
  all[chat] = list;
  let total = Object.values(all).reduce((n, entries) => n + entries.length, 0);
  while (total > TRANSCRIPT_MAX_TOTAL) {
    const oldest = Object.keys(all).find((key) => all[key].length);
    if (!oldest) break;
    all[oldest].shift();
    total--;
  }
  store[TRANSCRIPT_KEY] = all;
  await db.write();
  return list;
}

async function searchTranscripts(query, chat = null) {
  await db.init();
  const store = ensureStore();
  if (!store) return [];
  const all = store[TRANSCRIPT_KEY] || {};
  const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = [];
  for (const [jid, list] of Object.entries(all)) {
    if (chat && jid !== chat) continue;
    for (const entry of Array.isArray(list) ? list : []) {
      const text = String(entry.content || "").toLowerCase();
      const score = terms.filter((t) => text.includes(t)).length;
      if (score) hits.push({ chat: jid, role: entry.role, content: entry.content, at: entry.at, score });
    }
  }
  hits.sort((a, b) => b.score - a.score || b.at - a.at);
  return hits.slice(0, 10);
}

function writeSkill(name, body) {
  const safe = String(name || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!safe) return null;
  const content = String(body || "").trim();
  if (!content) return null;
  try {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SKILLS_DIR, `${safe}.md`), content);
    return safe;
  } catch {
    return null;
  }
}

function deleteSkill(name) {
  const safe = String(name || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return false;
  try {
    const file = path.join(SKILLS_DIR, `${safe}.md`);
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file);
    return true;
  } catch {
    return false;
  }
}

function listSkills() {
  try {
    return fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

function readSkill(name) {
  const safe = String(name || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return null;
  const file = path.join(SKILLS_DIR, `${safe}.md`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf-8").slice(0, MAX_SKILL_CHARS);
}

function searchSkills(query) {
  const q = String(query || "").trim().toLowerCase();
  const names = listSkills();
  if (!q) return names;
  return names.filter((name) => {
    if (name.toLowerCase().includes(q)) return true;
    const body = readSkill(name) || "";
    return body.toLowerCase().includes(q);
  });
}

async function buildPromptContext(chat) {
  const owner = await getFacts(OWNER_KEY);
  const facts = await getFacts(chat);
  const lines = [];
  if (owner.length) {
    lines.push("Account owner preferences:");
    for (const f of owner) lines.push(`- ${f}`);
  }
  if (facts.length) {
    lines.push("Things you remember about this person:");
    for (const f of facts) lines.push(`- ${f}`);
  }
  const skills = listSkills();
  if (skills.length) {
    lines.push(`Skills you can read with the read_skill tool: ${skills.join(", ")}`);
  }
  return lines.join("\n");
}

module.exports = {
  getFacts,
  remember,
  forget,
  clearFacts,
  clearTranscripts,
  logTranscript,
  searchTranscripts,
  listSkills,
  readSkill,
  searchSkills,
  writeSkill,
  deleteSkill,
  buildPromptContext,
  OWNER_KEY,
  TRANSCRIPT_KEY,
  OWNER_FACTS,
};
