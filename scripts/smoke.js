process.env.PREFIX = process.env.PREFIX || ".";
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || "6282170988479";
global.log = { info: () => {}, success: () => {}, warn: () => {}, error: (...a) => console.error(...a), cmd: () => {}, reload: () => {} };
global.footer = "smoke";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");

const cmdDir = path.join(__dirname, "..", "commands");
const files = fs.readdirSync(cmdDir).filter((f) => f.endsWith(".js")).sort();
const commands = new Map();
global.commands = commands;
for (const file of files) {
  const full = path.join(cmdDir, file);
  delete require.cache[require.resolve(full)];
  const mod = require(full);
  assert.ok(mod.name, `${file} has no name`);
  assert.strictEqual(typeof mod.run, "function", `${file} has no run()`);
  commands.set(mod.name, mod);
  for (const alias of mod.aliases || []) commands.set(alias, mod);
}
console.log(`commands loaded: ${new Set(commands.values()).size} (${files.length} files)`);

const sent = [];
const sock = {
  sendMessage: async (chat, payload) => { sent.push({ chat, payload }); return {}; },
  store: { chats: {}, messages: {} },
  groupMetadata: async () => ({ participants: [{ id: "1@s.whatsapp.net" }] }),
};
const m = {
  body: ".menu", text: ".menu", chat: "6282170988479@s.whatsapp.net",
  sender: "6282170988479@s.whatsapp.net", fromMe: true, isGroup: false,
  isPrivate: true, key: { id: "smoke1", remoteJid: "6282170988479@s.whatsapp.net" },
  reply: async (content) => { sent.push({ reply: content }); return {}; },
  react: async () => {},
};
(async () => {
  await commands.get("menu").run(sock, m, [], m.reply, m.chat);
  assert.ok(sent.length > 0, "menu sent nothing");
  console.log("menu dispatch: ok");
  const evFile = path.join(__dirname, "..", "events", "message.upsert.js");
  const src = fs.readFileSync(evFile, "utf-8");
  assert.ok(!src.includes("handleGameAnswer"), "dangling handleGameAnswer still present");
  console.log("event dispatch refs: ok");
  console.log("SMOKE PASS");
})().catch((e) => { console.error("SMOKE FAIL:", e.message); process.exit(1); });
