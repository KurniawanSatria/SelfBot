process.env.TMPDIR = process.env.TMPDIR || require("path").join(__dirname, "tmp");
try { require("fs").mkdirSync(process.env.TMPDIR, { recursive: true }); } catch {}
process.stdout.write("BOT_RUNNING\n");

require("dotenv").config();
const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);
const {
	useMultiFileAuthState,
	jidNormalizedUser,
	fetchLatestBaileysVersion,
	Browsers,
	generateWAMessageFromContent,
} = require("baileys");
const sharp = require("sharp");
const AUTH_DIR = process.env.AUTH_DIR || "./session";
const FEATURES = {
	AUTO_DOWNLOAD: process.env.AUTO_DOWNLOAD === "true",
	AUTO_READ: process.env.AUTO_READ === "true",
	ALWAYS_ONLINE: process.env.ALWAYS_ONLINE === "true",
	TYPING_INDICATOR: process.env.TYPING_INDICATOR === "true",
	ANTI_DELETE: process.env.ANTI_DELETE === "true",
	AUTO_REJECT_CALL: process.env.AUTO_REJECT_CALL === "true",
};
const CALL_WHITELIST = process.env.CALL_WHITELIST ? process.env.CALL_WHITELIST.split(",").map(s => s.trim()) : [];
const { createSocket } = require("./lib/socket");
const storeModule = require("./lib/store");
const makeInMemoryStore = storeModule.makeInMemoryStore || storeModule.default?.makeInMemoryStore;
const db = require("./lib/database");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const chalk = require("chalk");
const util = require("node:util");
const moment = require("moment-timezone");

const time = () => chalk.dim.bold(`[${moment.tz("Asia/Jakarta").format("YYYY-MM-DD HH:MM")}]`);
const log = {
	info: (...a) => console.log(time(), chalk.cyan("◆"), chalk.bold(...a)),
	success: (...a) => console.log(time(), chalk.green("✔"), chalk.bold(...a)),
	warn: (...a) => console.log(time(), chalk.yellow("⚠"), chalk.bold(...a)),
	error: (...a) => console.log(time(), chalk.red("✖"), chalk.bold(...a)),
	cmd: (...a) => console.log(time(), chalk.magenta("►"), chalk.bold(...a)),
	reload: (...a) => console.log(time(), chalk.blue("↻"), chalk.bold(...a)),
};
global.log = log;
process.on("uncaughtException", (err) => {
	log.error(`Uncaught Exception: ${util.format(err)}`);
});

process.on("unhandledRejection", (err) => {
	log.error(`Unhandled Rejection: ${util.format(err)}`);
});

const NOISY_PATTERNS = [
	/Closing session:/,
	/Closing open session/,
	/Closing stale open session/,
	/Removing old closed session:/,
];

function isNoisy(chunk) {
	const output = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
	return NOISY_PATTERNS.some((pattern) => pattern.test(output));
}

function suppressLibsignalNoise() {
	const originalStdoutWrite = process.stdout.write.bind(process.stdout);
	const originalStderrWrite = process.stderr.write.bind(process.stderr);
	process.stdout.write = function (chunk, ...args) {
		if (isNoisy(chunk)) return true;
		return originalStdoutWrite(chunk, ...args);
	};
	process.stderr.write = function (chunk, ...args) {
		if (isNoisy(chunk)) return true;
		return originalStderrWrite(chunk, ...args);
	};
	return () => {
		process.stdout.write = originalStdoutWrite;
		process.stderr.write = originalStderrWrite;
	};
}

suppressLibsignalNoise();

const cmdDir = path.join(__dirname, "commands");
const libDir = path.join(__dirname, "lib");
const eventsDir = path.join(__dirname, "events");
const tmpDir = path.join(__dirname, "tmp");
global.commands = new Map();

function debounce(fn, ms) {
	let t = null;
	return (...a) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...a), ms);
		if (t.unref) t.unref();
	};
}

function watchDir(dir, onChange) {
	try {
		fs.watch(dir, debounce(onChange, 250));
	} catch (e) {
		global.log.error(`Watch failed for ${dir}: ${e.message}`);
	}
}

function clearTmpDir() {
	fs.mkdirSync(tmpDir, { recursive: true });
	for (const entry of fs.readdirSync(tmpDir)) {
		fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
	}
	for (const entry of fs.readdirSync(__dirname)) {
		if (/^temp_.*\.mp4$/.test(entry) || /^\d+-\d+\.[a-z0-9]+$/.test(entry)) fs.rmSync(path.join(__dirname, entry), { force: true });
	}
}
setInterval(() => {
	for (const entry of fs.readdirSync(tmpDir)) {
		const p = path.join(tmpDir, entry);
		try { if (Date.now() - fs.statSync(p).mtimeMs > 3600000) fs.rmSync(p, { recursive: true, force: true }); } catch {}
	}
}, 1800000).unref?.();

global.footer = '© Saturiaaa.'
function loadCommands() {
	global.commands.clear();
	const files = fs.readdirSync(cmdDir).filter((f) => f.endsWith(".js"));
	for (const file of files) {
		const fullPath = path.join(cmdDir, file);
		delete require.cache[require.resolve(fullPath)];
		const mod = require(fullPath);
		if (!mod.name) continue;
		global.commands.set(mod.name, mod);
		for (const alias of mod.aliases ?? []) global.commands.set(alias, mod);
	}
	const names = [...new Set(global.commands.values())].map((m) => m.name).join(", ");
	global.log.success(chalk.bold(`${files.length} command(s) loaded`));
}

function watchCommands() {
	watchDir(cmdDir, () => {
		global.log.reload("Hot-reload: commands");
		loadCommands();
	});
}

function restartProcess(reason) {
	log.reload(`${reason}, restarting...`);
	if (typeof process.send === "function") {
		process.send("reset");
	} else {
		process.exit(0);
	}
}

function watchLibs() {
	watchDir(libDir, () => restartProcess("Hot-reload lib"));
}

loadCommands();
watchCommands();
watchLibs();
watchDir(eventsDir, () => restartProcess("Hot-reload event"));

async function loadEvents(sock, deps = {}) {
	const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith(".js"));
	for (const file of files) {
		try {
			const mod = require(path.join(eventsDir, file));
			if (typeof mod.register !== "function") {
				global.log?.warn(`Skipping ${file}: no register() export`);
				continue;
			}
			mod.register(sock, deps);
			global.log?.info(`Loaded: ${file}`);
		} catch (err) {
			global.log?.error(`Failed to load Event ${file}: ${err.message}`);
		}
	}
}

function getStoreChatCount(store) {
	const chats = store?.chats;
	if (!chats) return 0;
	if (typeof chats.size === "number") return chats.size;
	if (Array.isArray(chats)) return chats.length;
	if (typeof chats === "object") return Object.keys(chats).length;
	return 0;
}

const start = async () => {
	clearTmpDir();
	global.log.info("Temporary files cleared");

	const STORE_FILE = path.join(__dirname, "session", "baileys_store.json");
	const store = makeInMemoryStore();
	store.readFromFile(STORE_FILE);
	global.log.info(`Store loaded: ${getStoreChatCount(store)} chats`);
	let isWritingStore = false;
	const saveStore = () => {
		try { store.writeToFile(STORE_FILE); } catch {}
	};
	setInterval(() => {
		if (isWritingStore) return;
		isWritingStore = true;
		try {
			store.writeToFile(STORE_FILE);
		} finally {
			isWritingStore = false;
		}
	}, 10_000);
	process.once("SIGINT", () => { saveStore(); db.flush(); });
	process.once("SIGTERM", () => { saveStore(); db.flush(); });
	const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
	const { version } = await fetchLatestBaileysVersion();
	const logger = pino({ level: "silent" });
	global.logger = logger;
	global.log.info(`Baileys version: ${chalk.cyan(version.join("."))}`);

	const connectionOptions = {
		version,
		auth: state,
		printQRInTerminal: false,
		logger,
		markOnlineOnConnect: true,
		syncFullHistory: false,
		connectTimeoutMs: 60000,
		defaultQueryTimeoutMs: 0,
		generateHighQualityLinkPreview: true,
		getMessage: async (key) => {
			const jid = jidNormalizedUser(key.remoteJid);
			const msg = await store.loadMessage(jid, key.id);
			return msg?.message || "";
		},
	};

	const sock = await createSocket(connectionOptions);

	try {
		const crmstore = require("./lib/crmstore");
		global.crmstore = crmstore;
		crmstore.bind(sock);
		global.log.success("CRMStore bound");
	} catch (e) {
		global.log.error(`CRMStore failed: ${e.message}`);
	}

	store.bind(sock.ev);

	sock.store = store;

	try {
		await db.init();
		global.db = db.db;
		global.log.success("Database initialized");

		await db.loadAllChatsFromStore(sock.store);
		global.log.success(`Loaded ${getStoreChatCount(store)} chats to database`);

		setInterval(
			async () => {
				try {
					const cleaned = await db.cleanupExpiredSessions();
					if (cleaned > 0) {
						global.log.info(`Cleaned up ${cleaned} expired sessions`);
					}
				} catch (err) {
					global.log.error(`Session cleanup error: ${err.message}`);
				}
			},
			60 * 60 * 1000,
		);
	} catch (err) {
		global.log.error(`Database init error: ${err.message}`);
	}

	await loadEvents(sock, { saveCreds, restartFn: start });
	const processedCalls = new Set();
	sock.ev.on("call", async (calls) => {
		if (!FEATURES?.AUTO_REJECT_CALL) return;
		const call = calls[0];
		if (!call || processedCalls.has(call.id)) return;
		processedCalls.add(call.id);
		setTimeout(() => processedCalls.delete(call.id), 300000);
		const callerNumber = call.from.split("@")[0];
		if ((CALL_WHITELIST || []).includes(callerNumber)) return;
		try {
			await sock.rejectCall(call.id, call.from);
		} catch (e) {
			global.log?.error(`Auto-reject call error: ${e.message}`);
		}
	});

	return sock;
};
console.clear();
start().catch((err) => {
	global.log.error("Fatal error:", JSON.stringify(util.format(err), null, 2));
	process.exit(1);
});

try {
	fs.watch(__filename, debounce(() => restartProcess(`${__filename} updated`), 250));
} catch {}
