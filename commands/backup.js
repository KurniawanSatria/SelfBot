const { exec } = require("node:child_process");
const fs = require("fs");
const path = require("path");
const BOT_ROOT = path.join(__dirname, "..");

module.exports = {
	name: "backup",
	aliases: ["bak", "archive"],
	category: "Owner",
	cooldown: 0,
	description: "Create a .zip archive of the bot (excludes .npm, node_modules, session). Owner only.",
	async run(sock, m, args, reply, chat) {
		const senderNumber = (m.sender || "").split("@")[0];
		const { OWNER_NUMBERS } = require("../lib/config");
		const isOwner = m.fromMe || OWNER_NUMBERS.includes(senderNumber);
		if (!isOwner) return reply("╰─ This command is owner-only.");
		const { spawnSync } = require("node:child_process");
		const zipOk = spawnSync("zip", ["-v"], { stdio: "ignore" }).status === 0;
		if (!zipOk) return reply("╰─ `zip` binary is unavailable on this server.");
		await reply("⌁ Creating bot backup...\n⌁ Please wait a moment.");
		const ts = new Date().toISOString().replace(/[:.]/g, "-");
		const outZip = path.join(BOT_ROOT, "tmp", `backup-${ts}.zip`);
		fs.mkdirSync(path.join(BOT_ROOT, "tmp"), { recursive: true });
		const excludes = [ ".npm/*", ".bun/*", ".recyclebin", "node_modules/*", "session/*", "tmp/*", ".git/*", "data/*" ].map((p) => `-x '${p}'`).join(" ");
		const cmd = `cd ${JSON.stringify(BOT_ROOT)} && zip -r ${JSON.stringify(outZip)} . ${excludes}`;
		exec(cmd, { maxBuffer: 1024 * 1024 * 256 }, async (err, stdout, stderr) => {
			try {
				if (err) return reply("╰─ Backup creation failed:\n" + (stderr || err.message),);
				if (!fs.existsSync(outZip)) return reply("╰─ Backup file not found after process.");
				const stats = fs.statSync(outZip);
				const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
				if (stats.size > 100 * 1024 * 1024) {
					fs.unlink(outZip, () => { });
					return reply(`⚠️ Backup is too large (${sizeMB} MB) and exceeds the WhatsApp upload limit (~100MB).\n` + `Try excluding other folders (e.g. assets/ or data/) or upload it manually.`);
				}
				const thumbPath = path.join(BOT_ROOT, "assets", "thumbnail2.jpg");
			const payload = { document: { url: outZip }, fileName: path.basename(outZip), mimetype: "application/zip" };
			if (fs.existsSync(thumbPath)) payload.jpegThumbnail = fs.readFileSync(thumbPath);
			await sock.sendMessage(chat, payload, { quoted: m });
				const dbFile = path.join(BOT_ROOT, "data", "allowed.json");
				if (fs.existsSync(dbFile)) {
					await sock.sendMessage(chat, { document: { url: dbFile }, fileName: `database-${ts}.json`, mimetype: "application/json" }, { quoted: m });
				}
				fs.unlink(outZip, () => { });
			} catch (e) {
				reply("╰─ Failed to send backup: " + e.message);
			}
		});
	},
};
