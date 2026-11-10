process.env.PREFIX = ".";
require("dotenv").config();
global.log = { info() {}, success() {}, warn() {}, error() {}, cmd() {}, reload() {} };

const ai = require("../lib/ai");
const memory = require("../lib/memory");
const scheduler = require("../lib/scheduler");

const owner = "6282170988479@s.whatsapp.net";
const RED_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

function makeSock(sent, extra = {}) {
	return {
		user: { id: "6282170988479:12@s.whatsapp.net" },
		store: { chats: {}, messages: {} },
		sendPresenceUpdate: async () => ({}),
		sendMessage: async (jid, content) => { sent.push(content); return {}; },
		...extra,
	};
}

function makeMsg(chat, body, extra = {}) {
	return {
		fromMe: true, body, text: body, chat, isPrivate: true,
		sender: owner, reply: async () => ({}), ...extra,
	};
}

const tasks = [
	{
		name: "web_research",
		turns: ["What is the current price of Bitcoin in USD? Answer with one sentence."],
		check: (text) => /(\$|usd|dollar)/i.test(text) && /\d/.test(text),
	},
	{
		name: "vision",
		turns: ["What color is this image? Answer in one word."],
		extra: { mtype: "imageMessage", msg: { mimetype: "image/png" } },
		sockExtra: { downloadMediaMessage: async () => RED_PNG },
		check: (text) => /red/i.test(text),
	},
	{
		name: "multi_step",
		turns: ["Search the web for the official Python website, then fetch the page and tell me the exact page title."],
		check: (text) => /welcome to python\.org/i.test(text),
	},
	{
		name: "memory_recall",
		turns: ["Remember: the gate code is 4815.", "What is the gate code?"],
		check: (text) => /4815/.test(text),
		teardown: async (chat) => { await memory.clearTranscripts(chat); },
	},
	{
		name: "scheduling",
		turns: ["Remind me to call the doctor in 1 minute."],
		check: async (_text, chat) => (await scheduler.listJobs(chat)).length > 0,
		teardown: async (chat) => {
			for (const job of await scheduler.listJobs(chat)) await scheduler.removeJob(job.id);
		},
	},
];

(async () => {
	let passed = 0;
	for (const task of tasks) {
		const chat = `628000000${1000 + Math.floor(Math.random() * 9000)}@s.whatsapp.net`;
		ai.sessions.set(chat, { history: [], lastReply: 0, busy: false, pending: [] });
		const sent = [];
		const sock = makeSock(sent, task.sockExtra || {});
		const started = Date.now();
		let finalText = "";
		try {
			for (const turn of task.turns) {
				await ai.maybeReply(sock, makeMsg(chat, turn, task.extra || {}));
			}
			finalText = sent.filter((s) => !s.edit).map((s) => s.text).filter(Boolean).at(-1) || "";
			const ok = await task.check(finalText, chat);
			if (ok) passed++;
			console.log(`${ok ? "PASS" : "FAIL"} ${task.name} (${Date.now() - started}ms)`);
		} catch (err) {
			console.log(`FAIL ${task.name} (${Date.now() - started}ms) ERROR: ${err.message}`);
		}
		console.log(`     ${finalText.slice(0, 240).replace(/\n/g, " ")}`);
		if (task.teardown) await task.teardown(chat);
		ai.sessions.delete(chat);
	}
	console.log(`\n${passed}/${tasks.length} tasks passed`);
	process.exit(0);
})();
