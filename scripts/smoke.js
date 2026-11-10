process.env.PREFIX = process.env.PREFIX || ".";
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || "6282170988479";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "smoke-test-key";
process.env.OPENAI_FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || "smoke-fallback-model";
require("dotenv").config();
global.log = { info: () => {}, success: () => {}, warn: () => {}, error: (...a) => console.error(...a), cmd: () => {}, reload: () => {} };
global.footer = "smoke";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");
const moment = require("moment-timezone");

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
  const before = sent.length;
  const mm = {
    body: "/new", text: "/new", chat: sessionChat,
    sender: "6282170988479@s.whatsapp.net", fromMe: true, isPrivate: true, isGroup: false,
    reply: async () => ({}),
  };
  const handled = await ai.handleControl(sock, mm);
  assert.strictEqual(handled, true, "/new was not handled");
  assert.ok(ai.sessions.has(sessionChat), "/new did not create a session");
  assert.ok(sent.slice(before).some((s) => String(s.payload?.text || "").includes("Clara is ready")), "/new did not confirm");

  const mmEnd = { ...mm, body: "/close", text: "/close" };
  const beforeClose = sent.length;
  await ai.handleControl(sock, mmEnd);
  assert.ok(!ai.sessions.has(sessionChat), "/close did not remove the session");
  assert.ok(sent.slice(beforeClose).some((s) => String(s.payload?.text || "").includes("Clara session closed")), "/close did not confirm");
  console.log("ai session control: ok");

  const ignored = await ai.maybeReply(sock, { ...mm, body: "hello", text: "hello", fromMe: true });
  assert.strictEqual(ignored, false, "AI replied while no session is active");
  console.log("ai session gate: ok");

  const selfSock = { user: { id: "6282170988479:12@s.whatsapp.net" }, sendMessage: async () => ({}), store: { chats: {}, messages: {} } };
  assert.strictEqual(ai.isOwnerInstruction({ fromMe: true, sender: "628999@s.whatsapp.net" }, selfSock), true, "fromMe counts as owner");
  assert.strictEqual(ai.isOwnerInstruction({ fromMe: false, sender: "6282170988479@s.whatsapp.net" }, selfSock), true, "self number counts as owner");
  assert.strictEqual(ai.isOwnerInstruction({ fromMe: false, sender: "628111@s.whatsapp.net" }, selfSock), false, "stranger is not owner");
  assert.strictEqual(ai.isOwnerInstruction({ fromMe: false, sender: "628111@s.whatsapp.net" }, {}), false, "missing sock user must not grant owner");
  const lidSock = { ...selfSock, signalRepository: { lidMapping: { getPNForLID: async (jid) => (jid === "998877@lid" ? "6282170988479@s.whatsapp.net" : null) } } };
  assert.strictEqual(ai.isOwnerInstruction({ fromMe: false, sender: "998877@lid", chat: "6282170988479@s.whatsapp.net" }, lidSock), false, "lid sender alone cannot match a phone jid");
  assert.strictEqual(await ai.isOwnerInstructionAsync({ fromMe: false, sender: "998877@lid", chat: "998877@lid" }, lidSock), true, "lid mapping should resolve owner");
  assert.strictEqual(await ai.isOwnerInstructionAsync({ fromMe: false, sender: "555@lid" }, lidSock), false, "unmapped lid is not owner");
  assert.strictEqual(await ai.isOwnerInstructionAsync({ fromMe: false, sender: "555@lid" }, selfSock), false, "missing lidMapping must not throw");
  assert.strictEqual(ai.isSelfChat({ chat: "6282170988479@s.whatsapp.net" }, selfSock), true, "chat with own number is self chat");
  assert.strictEqual(ai.isSelfChat({ chat: "628111@s.whatsapp.net" }, selfSock), false, "chat with another number is not self chat");
  assert.strictEqual(ai.isSelfChat({ chat: "628111@s.whatsapp.net" }, {}), false, "missing sock user is not self chat");

  const selfChatKey = "6282170988479@s.whatsapp.net";
  ai.sessions.set(selfChatKey, { history: [], lastReply: 0, busy: false });
  const aiSent = [];
  const taggedSock = { ...selfSock, sendPresenceUpdate: async () => ({}), sendMessage: async (jid, content, opts) => { aiSent.push({ jid, content, opts }); return {}; } };
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "halo juga" } }] }) });
  const res = await ai.maybeReply(taggedSock, { fromMe: true, body: "hai", text: "hai", chat: selfChatKey, isPrivate: true, sender: "6282170988479@s.whatsapp.net", reply: async () => ({}) });
  global.fetch = origFetch;
  assert.strictEqual(res, true, "self chat owner message should get an AI reply");
  assert.strictEqual(aiSent.length, 1, "self chat reply must be sent once");
  assert.ok(aiSent[0].opts.messageId.startsWith(ai.AI_MSG_TAG), "AI reply must carry the custom message id prefix");
  const recorded = ai.sessions.get(selfChatKey).history;
  assert.deepStrictEqual(recorded.map((h) => h.content), ["hai", "halo juga"], "history should record the exchange");

  const failingSock = { ...selfSock, sendPresenceUpdate: async () => ({}), sendMessage: async () => { throw new Error("send failed"); } };
  ai.sessions.set(selfChatKey, { history: [], lastReply: 0, busy: false });
  global.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "halo juga" } }] }) });
  const failed = await ai.maybeReply(failingSock, { fromMe: true, body: "hai", text: "hai", chat: selfChatKey, isPrivate: true, sender: "6282170988479@s.whatsapp.net", reply: async () => ({}) });
  global.fetch = origFetch;
  assert.strictEqual(failed, false, "failed send must not report success");
  assert.deepStrictEqual(ai.sessions.get(selfChatKey).history, [], "failed send must not record a reply that never went out");

  ai.sessions.delete(selfChatKey);
  console.log("ai self chat: ok");

  const relayCalls = [];
  const relaySock = { user: { id: "6282170988479:12@s.whatsapp.net" }, relayMessage: async (jid, msg, opts) => { relayCalls.push({ jid, msg, opts }); return opts.messageId; } };
  const relayId = await ai.sendTagged(relaySock, selfChatKey, "tes", undefined);
  assert.strictEqual(relayCalls.length, 1, "relay path should be used when available");
  assert.ok(relayId.startsWith(ai.AI_MSG_TAG), "relay id must carry the tag");
  assert.strictEqual(relayCalls[0].opts.messageId, relayId, "relay must use the tagged id");

  const fallbackCalls = [];
  const brokenRelaySock = { user: { id: "6282170988479:12@s.whatsapp.net" }, relayMessage: async () => { throw new Error("bad quoted"); }, sendMessage: async (jid, content, opts) => { fallbackCalls.push({ jid, content, opts }); return {}; } };
  const origWarn = global.log.warn;
  global.log.warn = () => {};
  const fallbackId = await ai.sendTagged(brokenRelaySock, selfChatKey, "tes", { key: { id: "Q1" } });
  global.log.warn = origWarn;
  assert.strictEqual(fallbackCalls.length, 1, "broken relay must fall back to sendMessage");
  assert.ok(fallbackId.startsWith(ai.AI_MSG_TAG), "fallback id must carry the tag");
  assert.strictEqual(fallbackCalls[0].opts.quoted.key.id, "Q1", "fallback must keep the quote");
  console.log("ai tagged send: ok");

  const aiRaw = fs.readFileSync(path.join(__dirname, "..", "lib", "ai.js"), "utf-8");
  const trimSrc = aiRaw.slice(aiRaw.indexOf("function trimHistory"), aiRaw.indexOf("function extractJson"));
  const makeTrim = (budget) => {
    const fn = new Function("HISTORY_TOKEN_BUDGET", `${trimSrc}; return trimHistory;`)(budget);
    return fn;
  };
  const bulk = "x".repeat(3500);
  const bulkSession = { history: [{ role: "user", content: bulk }, { role: "assistant", content: "short" }] };
  makeTrim(1000)(bulkSession, 500);
  assert.strictEqual(bulkSession.history.length, 1, "oversized oldest entries must be dropped");
  assert.strictEqual(bulkSession.history[0].content, "short", "trim must keep the newest entry");

  const fitsSession = { history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] };
  makeTrim(1000)(fitsSession, 10);
  assert.strictEqual(fitsSession.history.length, 2, "trim must not drop entries that fit");

  const overheadSession = { history: [{ role: "user", content: "a" }] };
  makeTrim(1000)(overheadSession, 0);
  assert.strictEqual(overheadSession.history.length, 1, "trim must be a no-op when overhead is unknown");
  console.log("ai history budget: ok");

  const { stripEmoji } = require("../lib/text");
  assert.strictEqual(stripEmoji("hello world"), "hello world", "plain text must survive");
  assert.strictEqual(stripEmoji("wow so cool 🔥🔥"), "wow so cool", "emoji must be dropped");
  assert.strictEqual(stripEmoji("yes 😀 ok"), "yes ok", "inline emoji must not leave double spaces");
  assert.strictEqual(stripEmoji("done :fire: now"), "done now", "emoji shortcodes must be dropped");
  assert.strictEqual(stripEmoji("flag 🇮🇩 here"), "flag here", "regional indicator flags must be dropped");
  assert.strictEqual(stripEmoji("family 👨‍👩‍👧 here"), "family here", "zwj sequences must be dropped");
  assert.strictEqual(stripEmoji("日本語 tetap"), "日本語 tetap", "non-latin text must survive");
  assert.strictEqual(stripEmoji(""), "", "empty stays empty");
  assert.strictEqual(stripEmoji(null), "", "null becomes empty");

  const aiPrompt = fs.readFileSync(path.join(__dirname, "..", "lib", "ai.js"), "utf-8");
  assert.ok(aiPrompt.includes("always write in English"), "system prompt must force english replies");
  assert.ok(aiPrompt.includes("never output emoji"), "system prompt must forbid emoji");
  assert.ok(!aiPrompt.includes("Match the language the other person uses"), "old language-matching rule must be gone");
  console.log("ai language and emoji: ok");

  console.log("ai owner gate: ok");

  const aiSource = fs.readFileSync(path.join(__dirname, "..", "lib", "ai.js"), "utf-8");
  const helper = aiSource.slice(aiSource.indexOf("function extractJson"), aiSource.indexOf("async function chat"));
  const extractJson = new Function(`${helper}; return extractJson;`)();
  assert.deepStrictEqual(extractJson('{"a":1}'), { a: 1 }, "plain json should parse");
  assert.deepStrictEqual(extractJson('{"a":1}{"b":2}'), { a: 1 }, "concatenated json should keep the first object");
  assert.deepStrictEqual(extractJson('{"a":"x}y"}\n data: [DONE]'), { a: "x}y" }, "trailing stream text should be dropped");
  assert.deepStrictEqual(extractJson('\n\n{"choices":[{"message":{"content":"hi"}}]}'), { choices: [{ message: { content: "hi" } }] }, "leading whitespace should be tolerated");
  assert.throws(() => extractJson(""), /Empty response body/, "empty body should throw");
  assert.throws(() => extractJson("not json at all"), /Non-JSON response/, "garbage should throw a clear error");
  assert.throws(() => extractJson('{"a":'), /Malformed JSON/, "truncated json should throw a clear error");
  console.log("ai json hardening: ok");

  const tts = require("../lib/tts");
  assert.strictEqual(typeof tts.synthesize, "function", "tts.synthesize missing");
  await assert.rejects(() => tts.synthesize(""), /Empty text/, "tts should reject empty text");
  assert.strictEqual(tts.isReady(), true, "tts.isReady should be true with key + default voice");
  console.log("tts guard: ok");

  const stt = require("../lib/stt");
  assert.strictEqual(typeof stt.transcribe, "function", "stt.transcribe missing");
  assert.strictEqual(stt.isReady(), Boolean(process.env.FISH_APIKEY), "stt.isReady should follow FISH_APIKEY");
  await assert.rejects(() => stt.transcribe(""), /audio is empty/, "stt should reject empty audio");
  if (!stt.isReady()) await assert.rejects(() => stt.transcribe(Buffer.from([1])), /FISH_APIKEY/, "stt should reject when unconfigured");
  const sttFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ text: "halo apa kabar" }) });
  assert.strictEqual(await stt.transcribe(Buffer.from([1, 2, 3])), "halo apa kabar", "stt should return the transcript");
  global.fetch = async () => ({ ok: false, status: 400, text: async () => "bad" });
  await assert.rejects(() => stt.transcribe(Buffer.from([1, 2, 3])), /ASR HTTP 400/, "stt should surface API errors");
  global.fetch = async () => ({ ok: true, json: async () => ({ text: "   " }) });
  await assert.rejects(() => stt.transcribe(Buffer.from([1, 2, 3])), /no speech found/, "stt should reject empty transcripts");
  global.fetch = sttFetch;
  console.log("stt guard: ok");

  const sender = require("../lib/sender");
  assert.ok(sender.VALID_TYPES.includes("poll"), "sender missing poll type");
  assert.ok(sender.VALID_TYPES.includes("sticker"), "sender missing sticker type");
  await assert.rejects(() => sender.send(sock, m, { type: "hack" }), /unsupported type/, "sender should reject unknown type");
  await assert.rejects(() => sender.send(sock, m, { type: "image" }), /empty/, "sender should reject image without source");
  await assert.rejects(() => sender.send(sock, m, { type: "album", urls: [] }), /at least one url/, "sender should reject empty album");

  const tagged = [];
  const tagSock = { ...sock, sendMessage: async (chat, payload, opts) => { tagged.push({ payload, opts }); return {}; } };
  await sender.send(tagSock, m, { type: "text", text: "halo" }, "CLARATEST");
  assert.strictEqual(tagged[0].opts.messageId, "CLARATEST", "sender must forward the custom message id");
  await sender.send(tagSock, m, { type: "text", text: "halo" });
  assert.strictEqual(tagged[1].opts.messageId, undefined, "sender must not invent a message id");
  await sender.send(tagSock, m, { type: "text", text: "hi 🎉 there" }, "CLARAEMOJI");
  assert.strictEqual(tagged[2].payload.text, "hi there", "sender must strip emoji from text");
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

  const trChat = "6280000000222@s.whatsapp.net";
  await memory.logTranscript(trChat, "user", "besok ada rapat pagi");
  await memory.logTranscript(trChat, "assistant", "baik, saya ingatkan");
  const trHits = await memory.searchTranscripts("rapat", trChat);
  assert.ok(trHits.some((h) => h.content.includes("rapat")), "transcript search should find the keyword");
  const scopedHits = await memory.searchTranscripts("rapat", "6280000000333@s.whatsapp.net");
  assert.strictEqual(scopedHits.length, 0, "chat-scoped search must not leak other chats");
  assert.ok((await memory.searchTranscripts("rapat")).length >= 1, "global search should find the transcript");
  assert.ok(await memory.clearTranscripts(trChat) >= 1, "clearTranscripts should remove stored entries");
  console.log("memory transcripts: ok");

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
  assert.ok(!/if \(!body\) continue;/.test(upsertSrc), "handler must let image-only messages reach the AI session");
  assert.ok(upsertSrc.includes('m.mtype !== "audioMessage"'), "handler must let voice notes reach the AI session");
  const sessionIdx = upsertSrc.indexOf("if (ai.sessions.has(m.chat))");
  const strangerIdx = upsertSrc.indexOf("if (!fromOwner) continue;");
  assert.ok(sessionIdx !== -1 && strangerIdx !== -1 && sessionIdx < strangerIdx, "session dispatch must run before the stranger command gate");
  console.log("shell wiring: ok");

  const jsonMessage = (message) => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message }] }) });
  const ownerMsg = (chat, extra = {}) => ({
    fromMe: true, body: "hi", text: "hi", chat, isPrivate: true,
    sender: "6282170988479@s.whatsapp.net", reply: async () => ({}), ...extra,
  });
  const quietSock = (sink) => ({
    ...selfSock,
    sendPresenceUpdate: async () => ({}),
    sendMessage: async (jid, content, opts) => { sink.push({ jid, content, opts }); return {}; },
    store: { chats: {}, messages: {} },
  });

  const gatedNames = ai.availableTools({ tts: false, search: false }).map((t) => t.function.name);
  assert.ok(!gatedNames.includes("send_voice_note"), "voice tool must be gated on tts");
  assert.ok(!gatedNames.includes("web_search") && !gatedNames.includes("web_fetch"), "web tools must be gated on search");
  assert.ok(gatedNames.includes("remember") && gatedNames.includes("send_message"), "core tools must stay available");
  const readyNames = ai.availableTools().map((t) => t.function.name);
  assert.strictEqual(readyNames.includes("send_voice_note"), tts.isReady(), "voice tool must follow tts readiness");
  assert.strictEqual(readyNames.includes("web_search"), search.isReady(), "web tool must follow search readiness");
  console.log("ai tool gating: ok");

  const loopChat = "6280000000004@s.whatsapp.net";
  ai.sessions.set(loopChat, { history: [], lastReply: 0, busy: false, pending: [] });
  const loopSent = [];
  let loopCall = 0;
  global.fetch = async () => {
    loopCall++;
    if (loopCall === 1) return jsonMessage({ content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "remember", arguments: "{\"fact\":\"suka teh\"}" } }] });
    return jsonMessage({ content: "Noted, sir." });
  };
  const loopOk = await ai.maybeReply(quietSock(loopSent), ownerMsg(loopChat, { body: "ingat suka teh", text: "ingat suka teh" }));
  assert.strictEqual(loopOk, true, "tool loop should complete");
  assert.ok(loopSent.some((s) => s.content?.text === "Noted, sir."), "tool loop should send the follow-up answer");
  assert.strictEqual(loopSent.at(-1).content?.text, "Noted, sir.", "follow-up answer should be the last message");
  assert.ok(loopSent.some((s) => s.content?.edit), "tool activity should be shown in the progress message");
  assert.ok((await memory.getFacts(loopChat)).some((f) => f.includes("suka teh")), "remember tool should run inside the loop");
  console.log("ai tool loop: ok");

  const qChat = "6280000000005@s.whatsapp.net";
  ai.sessions.set(qChat, { history: [], lastReply: 0, busy: true, pending: [] });
  const qSent = [];
  global.fetch = async () => jsonMessage({ content: "pong" });
  const queued = await ai.maybeReply(quietSock(qSent), ownerMsg(qChat, { body: "hello", text: "hello" }));
  assert.strictEqual(queued, true, "busy message should be accepted");
  assert.deepStrictEqual(ai.sessions.get(qChat).pending, ["hello"], "busy message should be queued");
  ai.sessions.get(qChat).busy = false;
  await ai.maybeReply(quietSock(qSent), ownerMsg(qChat, { body: "second", text: "second" }));
  assert.strictEqual(qSent.length, 2, "queued message should be answered after the current turn");
  assert.strictEqual(ai.sessions.get(qChat).pending.length, 0, "pending queue should drain");
  console.log("ai pending queue: ok");

  const quoteChat = "6280000000006@s.whatsapp.net";
  ai.sessions.set(quoteChat, { history: [], lastReply: 0, busy: false, pending: [] });
  let quoteBody = null;
  global.fetch = async (url, opts) => { quoteBody = JSON.parse(opts.body); return jsonMessage({ content: "ok" }); };
  await ai.maybeReply(quietSock([]), ownerMsg(quoteChat, { body: "what is this?", text: "what is this?", quotedBody: "a cat photo" }));
  const quoteUser = quoteBody.messages[quoteBody.messages.length - 1];
  const quoteText = Array.isArray(quoteUser.content) ? quoteUser.content.find((p) => p.type === "text").text : quoteUser.content;
  assert.ok(quoteText.includes("Replying to") && quoteText.includes("a cat photo"), "quoted text should reach the model");
  console.log("ai quoted context: ok");

  const imgChat = "6280000000007@s.whatsapp.net";
  ai.sessions.set(imgChat, { history: [], lastReply: 0, busy: false, pending: [] });
  let imgBody = null;
  global.fetch = async (url, opts) => { imgBody = JSON.parse(opts.body); return jsonMessage({ content: "A red square." }); };
  const imgSock = { ...quietSock([]), downloadMediaMessage: async () => Buffer.from([1, 2, 3]) };
  const imgOk = await ai.maybeReply(imgSock, ownerMsg(imgChat, { body: "", text: "", mtype: "imageMessage", msg: { mimetype: "image/jpeg" } }));
  assert.strictEqual(imgOk, true, "image-only message should get a reply");
  const imgParts = imgBody.messages[imgBody.messages.length - 1].content;
  assert.ok(Array.isArray(imgParts), "image input must be multimodal");
  assert.ok(imgParts.some((p) => p.type === "image_url" && String(p.image_url.url).startsWith("data:image/jpeg;base64,")), "image should be sent as a data url");
  console.log("ai vision input: ok");

  const voiceChat = "6280000000121@s.whatsapp.net";
  ai.sessions.set(voiceChat, { history: [], lastReply: 0, busy: false, pending: [] });
  const voiceBodies = [];
  global.fetch = async (url, opts) => {
    if (String(url).includes("/v1/asr")) return { ok: true, json: async () => ({ text: "halo, apa kabar?" }) };
    voiceBodies.push(JSON.parse(opts.body));
    return jsonMessage({ content: "Kabar saya baik." });
  };
  const voiceSock = { ...quietSock([]), downloadMediaMessage: async () => Buffer.from([1, 2, 3]) };
  const voiceOk = await ai.maybeReply(voiceSock, {
    fromMe: true, body: "", text: "", mtype: "audioMessage", msg: { ptt: true, mimetype: "audio/ogg" },
    chat: voiceChat, isPrivate: true, sender: "6282170988479@s.whatsapp.net", reply: async () => ({}),
  });
  assert.strictEqual(voiceOk, true, "voice note should get a reply");
  const voiceUser = voiceBodies[0].messages[voiceBodies[0].messages.length - 1];
  const voiceText = Array.isArray(voiceUser.content) ? voiceUser.content.find((p) => p.type === "text").text : voiceUser.content;
  assert.ok(voiceText.includes("halo, apa kabar?"), "voice transcript should reach the model");
  ai.sessions.delete(voiceChat);
  console.log("ai voice note: ok");

  const routeChat = "6280000000131@s.whatsapp.net";
  ai.sessions.set(routeChat, { history: [], lastReply: 0, busy: false, pending: [] });
  const routedModels = [];
  global.fetch = async (url, opts) => {
    routedModels.push(JSON.parse(opts.body).model);
    return jsonMessage({ content: "Red" });
  };
  const routeSock = { ...quietSock([]), downloadMediaMessage: async () => Buffer.from([1, 2, 3]) };
  const routeOk = await ai.maybeReply(routeSock, ownerMsg(routeChat, {
    body: "what color?", text: "what color?", mtype: "imageMessage", msg: { mimetype: "image/png" },
  }));
  assert.strictEqual(routeOk, true, "image turn should complete");
  assert.strictEqual(routedModels[0], "smoke-fallback-model", "image turns should use the vision-capable fallback model");
  ai.sessions.delete(routeChat);
  console.log("ai vision routing: ok");

  const strangerChat = "6280000000111@s.whatsapp.net";
  ai.sessions.set(strangerChat, { history: [], lastReply: 0, busy: false, pending: [] });
  const strangerSent = [];
  global.fetch = async () => jsonMessage({ content: "Hello there." });
  const strangerOk = await ai.maybeReply(quietSock(strangerSent), {
    fromMe: false, body: "hi clara", text: "hi clara", chat: strangerChat, isPrivate: true,
    sender: "6289999999999@s.whatsapp.net", reply: async () => ({}),
  });
  assert.strictEqual(strangerOk, true, "session should answer the other person");
  assert.ok(strangerSent.some((s) => s.content?.text === "Hello there."), "other person should get the reply");
  ai.sessions.delete(strangerChat);
  console.log("ai stranger reply: ok");

  const skillChat = "6280000000444@s.whatsapp.net";
  ai.sessions.set(skillChat, { history: [], lastReply: 0, busy: false, pending: [] });
  let skillCalls = 0;
  global.fetch = async () => {
    skillCalls++;
    if (skillCalls === 1) {
      return jsonMessage({ content: null, tool_calls: [{ id: "s1", type: "function", function: { name: "save_skill", arguments: JSON.stringify({ name: "smoke-temp-skill", content: "---\nname: smoke-temp-skill\ndescription: smoke test\n---\n\n# Test\n" }) } }] });
    }
    return jsonMessage({ content: "Saved." });
  };
  await ai.maybeReply(quietSock([]), ownerMsg(skillChat, { body: "buat skill", text: "buat skill" }));
  assert.ok((memory.readSkill("smoke-temp-skill") || "").includes("description: smoke test"), "save_skill should write the file");
  assert.ok(memory.listSkills().includes("smoke-temp-skill"), "new skill should be listed");
  assert.strictEqual(memory.deleteSkill("smoke-temp-skill"), true, "deleteSkill should remove it");
  assert.strictEqual(memory.readSkill("smoke-temp-skill"), null, "deleted skill should be gone");
  ai.sessions.delete(skillChat);
  console.log("ai save_skill: ok");

  const blockedChat = "6280000000555@s.whatsapp.net";
  ai.sessions.set(blockedChat, { history: [], lastReply: 0, busy: false, pending: [] });
  let blockedCalls = 0;
  global.fetch = async () => {
    blockedCalls++;
    if (blockedCalls === 1) {
      return jsonMessage({ content: null, tool_calls: [{ id: "s2", type: "function", function: { name: "save_skill", arguments: JSON.stringify({ name: "smoke-blocked", content: "x" }) } }] });
    }
    return jsonMessage({ content: "ok" });
  };
  await ai.maybeReply(quietSock([]), { fromMe: false, body: "buat skill", text: "buat skill", chat: blockedChat, isPrivate: true, sender: "6289999999999@s.whatsapp.net", reply: async () => ({}) });
  assert.strictEqual(memory.readSkill("smoke-blocked"), null, "stranger must not be able to save skills");
  ai.sessions.delete(blockedChat);
  console.log("ai save_skill owner gate: ok");

  const recallChat = "6280000000666@s.whatsapp.net";
  await memory.logTranscript(recallChat, "user", "kuncinya ada di laci meja");
  ai.sessions.set(recallChat, { history: [], lastReply: 0, busy: false, pending: [] });
  const memBodies = [];
  global.fetch = async (url, opts) => {
    memBodies.push(JSON.parse(opts.body));
    if (memBodies.length === 1) {
      return jsonMessage({ content: null, tool_calls: [{ id: "m1", type: "function", function: { name: "search_memory", arguments: JSON.stringify({ query: "kunci" }) } }] });
    }
    return jsonMessage({ content: "Kuncinya di laci meja." });
  };
  const memOk = await ai.maybeReply(quietSock([]), ownerMsg(recallChat, { body: "dimana kunci?", text: "dimana kunci?" }));
  assert.strictEqual(memOk, true, "search_memory turn should complete");
  const toolResult = memBodies[1].messages.find((msg) => msg.role === "tool");
  assert.ok(toolResult && toolResult.content.includes("laci meja"), "search_memory result should reach the model");
  await memory.clearTranscripts(recallChat);
  ai.sessions.delete(recallChat);
  console.log("ai search_memory: ok");

  const fbChat = "6280000000777@s.whatsapp.net";
  ai.sessions.set(fbChat, { history: [], lastReply: 0, busy: false, pending: [] });
  const modelsTried = [];
  const fbSent = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    modelsTried.push(body.model);
    if (body.model === "smoke-fallback-model") return jsonMessage({ content: "from fallback" });
    throw new Error("primary down");
  };
  const fbOk = await ai.maybeReply(quietSock(fbSent), ownerMsg(fbChat, { body: "ping", text: "ping" }));
  assert.strictEqual(fbOk, true, "fallback should still answer");
  assert.strictEqual(modelsTried.length, 2, "fallback should be tried once");
  assert.strictEqual(modelsTried[1], "smoke-fallback-model", "second attempt must use the fallback model");
  assert.ok(fbSent.some((s) => s.content?.text === "from fallback"), "fallback reply should be sent");
  ai.sessions.delete(fbChat);
  console.log("ai provider fallback: ok");

  const scheduler = require("../lib/scheduler");
  const base = moment.tz("Asia/Jakarta");
  const relative = scheduler.parseWhen("in 10 menit", base);
  assert.ok(Math.abs(relative - (base.valueOf() + 10 * 60000)) < 1000, "relative minutes should parse");
  assert.strictEqual(moment(scheduler.parseWhen("jam 14:30", base)).tz("Asia/Jakarta").hour(), 14, "clock time should parse");
  assert.strictEqual(moment(scheduler.parseWhen("besok jam 8", base)).tz("Asia/Jakarta").hour(), 8, "tomorrow clock should parse");
  assert.strictEqual(scheduler.parseWhen("kapan saja"), null, "unknown time should be rejected");
  console.log("scheduler parse: ok");

  const schedChat = "6280000000888@s.whatsapp.net";
  const job = await scheduler.addJob(schedChat, "minum obat", Date.now() + 60000);
  assert.ok(job && job.id, "addJob should return a job");
  assert.strictEqual((await scheduler.listJobs(schedChat)).length, 1, "listJobs should find the job");
  assert.strictEqual(await scheduler.removeJob(job.id), true, "removeJob should delete it");
  assert.strictEqual((await scheduler.listJobs(schedChat)).length, 0, "removed job should be gone");
  console.log("scheduler jobs: ok");

  let fired = 0;
  const fire = async () => { fired++; };
  await scheduler.addJob(schedChat, "missed", Date.now() - 60 * 60 * 1000);
  await scheduler.runDue(sock, fire);
  assert.strictEqual(fired, 0, "missed job should not fire");
  assert.strictEqual((await scheduler.listJobs(schedChat)).length, 0, "missed job should be dropped");
  await scheduler.addJob(schedChat, "due", Date.now() - 1000);
  await scheduler.runDue(sock, fire);
  assert.strictEqual(fired, 1, "due job should fire once");
  await scheduler.addJob(schedChat, "daily", Date.now() - 1000, "daily");
  await scheduler.runDue(sock, fire);
  assert.strictEqual(fired, 2, "daily job should fire");
  const remaining = await scheduler.listJobs(schedChat);
  assert.strictEqual(remaining.length, 1, "daily job should stay scheduled");
  assert.ok(remaining[0].at > Date.now(), "daily job should move to tomorrow");
  await scheduler.removeJob(remaining[0].id);
  console.log("scheduler runDue: ok");

  let retryFires = 0;
  await scheduler.addJob(schedChat, "retry me", Date.now() - 1000);
  await scheduler.runDue(sock, async () => { retryFires++; return false; });
  assert.strictEqual(retryFires, 1, "failed job should be attempted once");
  const retried = await scheduler.listJobs(schedChat);
  assert.strictEqual(retried.length, 1, "failed job should be retried");
  assert.ok(retried[0].at > Date.now() + 30000, "retry should be about a minute later");
  await scheduler.removeJob(retried[0].id);
  console.log("scheduler retry: ok");

  ai.sessions.set(schedChat, { history: [], lastReply: 0, busy: false, pending: [] });
  let schedCalls = 0;
  global.fetch = async () => {
    schedCalls++;
    if (schedCalls === 1) {
      return jsonMessage({ content: null, tool_calls: [{ id: "j1", type: "function", function: { name: "schedule_message", arguments: JSON.stringify({ text: "ingatkan saya minum obat", when: "in 1 menit" }) } }] });
    }
    return jsonMessage({ content: "Terjadwal." });
  };
  await ai.maybeReply(quietSock([]), ownerMsg(schedChat, { body: "jadwalkan", text: "jadwalkan" }));
  const jobs = await scheduler.listJobs(schedChat);
  assert.strictEqual(jobs.length, 1, "schedule_message should store a job");
  assert.ok(jobs[0].text.includes("minum obat"), "job text should match");
  assert.ok(jobs[0].at > Date.now(), "job should be in the future");
  await scheduler.removeJob(jobs[0].id);
  ai.sessions.delete(schedChat);
  console.log("ai schedule_message: ok");

  const blockedSchedChat = "6280000000999@s.whatsapp.net";
  ai.sessions.set(blockedSchedChat, { history: [], lastReply: 0, busy: false, pending: [] });
  let blockedSchedCalls = 0;
  global.fetch = async () => {
    blockedSchedCalls++;
    if (blockedSchedCalls === 1) {
      return jsonMessage({ content: null, tool_calls: [{ id: "j2", type: "function", function: { name: "schedule_message", arguments: JSON.stringify({ text: "x", when: "in 1 menit" }) } }] });
    }
    return jsonMessage({ content: "ok" });
  };
  await ai.maybeReply(quietSock([]), { fromMe: false, body: "jadwalkan", text: "jadwalkan", chat: blockedSchedChat, isPrivate: true, sender: "6289999999999@s.whatsapp.net", reply: async () => ({}) });
  assert.strictEqual((await scheduler.listJobs(blockedSchedChat)).length, 0, "stranger must not schedule");
  ai.sessions.delete(blockedSchedChat);
  console.log("ai schedule owner gate: ok");

  ai.sessions.delete(loopChat);
  ai.sessions.delete(qChat);
  ai.sessions.delete(quoteChat);
  ai.sessions.delete(imgChat);
  global.fetch = origFetch;
  console.log("SMOKE PASS");
})().catch((e) => { console.error("SMOKE FAIL:", e.message); process.exit(1); });
