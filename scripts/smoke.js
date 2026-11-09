process.env.PREFIX = process.env.PREFIX || ".";
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || "6282170988479";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "smoke-test-key";
require("dotenv").config();
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

  const unbanFile = path.join(__dirname, "..", "commands", "unbanchat.js");
  const unbanSrc = fs.readFileSync(unbanFile, "utf-8");
  assert.ok(!unbanSrc.includes("AUTHORIZED_NUMBERS"), "unbanchat still references undefined AUTHORIZED_NUMBERS");
  assert.ok(unbanSrc.includes("OWNER_NUMBERS"), "unbanchat does not import OWNER_NUMBERS");
  console.log("event dispatch refs: ok");
  console.log("unbanchat owner check: ok");

  const ai = require("../lib/ai");
  assert.strictEqual(ai.isControl({ fromMe: true, body: "/new" }), true);
  assert.strictEqual(ai.isControl({ fromMe: false, body: "/new" }), false);
  assert.strictEqual(ai.isControl({ fromMe: true, body: "/close" }), true);
  assert.strictEqual(ai.isControl({ fromMe: true, body: ".menu" }), false);

  const sessionChat = "6281111111111@s.whatsapp.net";
  const replies = [];
  const mm = {
    body: "/new", text: "/new", chat: sessionChat,
    sender: "6282170988479@s.whatsapp.net", fromMe: true, isPrivate: true, isGroup: false,
    reply: async (content) => { replies.push(content); return {}; },
    sendMessage: async () => ({}),
  };
  const handled = await ai.handleControl(sock, mm);
  assert.strictEqual(handled, true, "/new was not handled");
  assert.ok(ai.sessions.has(sessionChat), "/new did not create a session");
  assert.ok(replies.some((r) => String(r).includes("session started")), "/new did not confirm");

  const mmEnd = { ...mm, body: "/close", text: "/close" };
  await ai.handleControl(sock, mmEnd);
  assert.ok(!ai.sessions.has(sessionChat), "/close did not remove the session");
  assert.ok(replies.some((r) => String(r).includes("session closed")), "/close did not confirm");
  console.log("ai session control: ok");

  const ignored = await ai.maybeReply(sock, { ...mm, body: "hello", text: "hello", fromMe: true });
  assert.strictEqual(ignored, false, "AI replied while no session is active");
  console.log("ai session gate: ok");

  const tts = require("../lib/tts");
  assert.strictEqual(typeof tts.synthesize, "function", "tts.synthesize missing");
  await assert.rejects(() => tts.synthesize(""), /Empty text/, "tts should reject empty text");
  assert.strictEqual(tts.isReady(), true, "tts.isReady should be true with key + default voice");
  console.log("tts guard: ok");

  const sender = require("../lib/sender");
  assert.ok(sender.VALID_TYPES.includes("poll"), "sender missing poll type");
  assert.ok(sender.VALID_TYPES.includes("sticker"), "sender missing sticker type");
  await assert.rejects(() => sender.send(sock, m, { type: "hack" }), /unsupported type/, "sender should reject unknown type");
  await assert.rejects(() => sender.send(sock, m, { type: "image" }), /empty/, "sender should reject image without source");
  await assert.rejects(() => sender.send(sock, m, { type: "album", urls: [] }), /at least one url/, "sender should reject empty album");
  console.log("sender guard: ok");

  const sendTool = ai.TOOLS.find((t) => t.function.name === "send_message");
  assert.ok(sendTool, "send_message tool missing");
  assert.ok(sendTool.function.parameters.properties.type.enum.includes("poll"), "send_message enum missing poll");
  console.log("send_message tool schema: ok");

  const voiceTool = ai.TOOLS.find((t) => t.function.name === "send_voice_note");
  assert.ok(voiceTool, "send_voice_note tool missing");
  assert.deepStrictEqual(voiceTool.function.parameters.required, ["text"], "voice tool should require text");
  console.log("tts tool schema: ok");

  const memory = require("../lib/memory");
  const memChat = "6280000000002@s.whatsapp.net";

  for (const fact of memory.OWNER_FACTS) await memory.remember(memory.OWNER_KEY, fact);
  const ownerFacts = await memory.getFacts(memory.OWNER_KEY);
  assert.ok(ownerFacts.some((f) => f.includes("full English")), "owner preference should be stored");
  const ownerCtx = await memory.buildPromptContext("6289999999999@s.whatsapp.net");
  assert.ok(ownerCtx.includes("Account owner preferences"), "owner preferences should reach every prompt");
  assert.ok(ownerCtx.includes("full English"), "code language preference should reach every prompt");

  await memory.remember(memChat, "suka kopi hitam");
  await memory.remember(memChat, "suka kopi hitam");
  let facts = await memory.getFacts(memChat);
  assert.deepStrictEqual(facts, ["suka kopi hitam"], "memory should dedupe facts");
  await memory.forget(memChat, "suka kopi hitam");
  facts = await memory.getFacts(memChat);
  assert.strictEqual(facts.length, 0, "forget should remove the fact");
  console.log("memory store: ok");

  await memory.remember(memChat, "kerja di jakarta");
  const ctx = await memory.buildPromptContext(memChat);
  assert.ok(ctx.includes("kerja di jakarta"), "prompt context should include facts");
  assert.ok(await memory.clearFacts(memChat) >= 1, "clearFacts should remove stored facts");
  console.log("memory prompt context: ok");

  assert.ok(memory.listSkills().includes("contoh"), "skills dir should list contoh");
  const owner = memory.readSkill("skill-creator") || "";
  assert.ok(owner.startsWith("---"), "skill-creator should start with frontmatter");
  assert.ok(/^name: skill-creator$/m.test(owner), "skill-creator should declare a name");
  assert.ok(/^description: \S/m.test(owner), "skill-creator should declare a description");
  assert.ok((memory.readSkill("contoh") || "").includes("Contoh Skill"), "readSkill should return content");
  assert.strictEqual(memory.readSkill("../etc/passwd"), null, "readSkill should reject path traversal");
  console.log("skills loader: ok");

  const search = require("../lib/search");
  assert.strictEqual(typeof search.search, "function", "search.search missing");
  assert.strictEqual(typeof search.fetchPage, "function", "search.fetchPage missing");
  await assert.rejects(() => search.search(""), /query is empty/, "search should reject empty query");
  await assert.rejects(() => search.fetchPage(""), /url is empty/, "fetchPage should reject empty url");
  await assert.rejects(() => search.fetchPage("file:///etc/passwd"), /http\(s\)/, "fetchPage should reject non-http url");
  await assert.rejects(() => search.fetchPage("http://127.0.0.1:8080/admin"), /private or local/, "fetchPage should reject loopback");
  await assert.rejects(() => search.fetchPage("http://169.254.169.254/latest/meta-data"), /private or local/, "fetchPage should reject link-local metadata");
  await assert.rejects(() => search.fetchPage("http://192.168.1.1/"), /private or local/, "fetchPage should reject private lan");
  await assert.rejects(() => search.fetchPage("http://localhost/"), /private or local/, "fetchPage should reject localhost");
  assert.strictEqual(search.format([]), "No results found.", "format should handle empty results");
  assert.ok(search.format([{ title: "A", url: "https://a.test", snippet: "b" }]).includes("https://a.test"), "format should include url");
  for (const tool of ["web_search", "web_fetch"]) {
    assert.ok(ai.TOOLS.find((t) => t.function.name === tool), `${tool} tool missing`);
  }
  console.log("search tools: ok");

  const shell = require("../lib/shell");
  assert.strictEqual(shell.check("").ok, false, "shell should reject empty command");
  assert.strictEqual(shell.check("rm -rf /").ok, false, "shell should reject rm");
  assert.strictEqual(shell.check("ls; whoami").ok, false, "shell should reject chaining");
  assert.strictEqual(shell.check("cat ../../etc/passwd").ok, false, "shell should reject traversal");
  assert.strictEqual(shell.check("ls").ok, true, "shell should allow ls");

  const shellChat = "6280000000003@s.whatsapp.net";
  assert.strictEqual(shell.request(shellChat, "curl evil.test").ok, false, "request should reject unlisted binary");
  assert.strictEqual(shell.hasPending(shellChat), false, "rejected command must not queue");
  assert.strictEqual(shell.request(shellChat, "echo hi").ok, true, "request should queue allowed command");
  assert.strictEqual(shell.hasPending(shellChat), true, "queued command should be pending");
  assert.strictEqual(shell.takePending(shellChat), "echo hi", "takePending should return the command");
  assert.strictEqual(shell.hasPending(shellChat), false, "takePending should clear the queue");
  console.log("shell guard: ok");

  const shellOut = await shell.run('node -e "process.stdout.write(String(1+1))"');
  assert.strictEqual(shellOut.ok, true, "shell.run should succeed");
  assert.ok(shellOut.output.includes("2"), "shell.run should capture stdout");
  console.log("shell exec: ok");

  assert.ok(ai.TOOLS.find((t) => t.function.name === "run_shell"), "run_shell tool missing");
  const upsertSrc = fs.readFileSync(path.join(__dirname, "..", "events", "message.upsert.js"), "utf-8");
  assert.ok(upsertSrc.includes("shell.hasPending"), "handler must route fromMe confirmations to ai.maybeReply");
  console.log("shell wiring: ok");
  console.log("SMOKE PASS");
})().catch((e) => { console.error("SMOKE FAIL:", e.message); process.exit(1); });
