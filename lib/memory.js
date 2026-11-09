const fs = require("fs");
const path = require("path");
const db = require("./database");

const MEMORY_LIMIT = Number(process.env.AI_MEMORY_LIMIT || 20);
const SKILLS_DIR = path.join(__dirname, "..", "skills");
const MAX_SKILL_CHARS = Number(process.env.AI_SKILL_MAX_CHARS || 4000);
const OWNER_KEY = "__owner__";

const OWNER_FACTS = [
  "Always write code in full English, including strings, comments, and UI text. Indonesian inside code strings feels odd to him.",
  "Reply to him in Indonesian lowercase; code and identifiers stay in English.",
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
  listSkills,
  readSkill,
  searchSkills,
  buildPromptContext,
  OWNER_KEY,
  OWNER_FACTS,
};
