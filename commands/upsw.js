const fs = require("fs");
const path = require("path");

module.exports = {
	name: "upsw",
	aliases: ["sw"],
	category: "Owner",
	description: "Upload Story Without Compression",
	cooldown: 5000,
	async run(sock, m, args, reply) {
		const { OWNER_NUMBERS } = require("../lib/config");
		const senderNumber = (m.sender || "").split("@")[0];
		if (!m.fromMe && !OWNER_NUMBERS.includes(senderNumber)) return reply("╰─ This command is owner-only.");
		const contactsPath = path.join(__dirname, "..", "contacts.json");
		if (!fs.existsSync(contactsPath)) return reply("╰─ contacts.json is not configured.");
		const list = JSON.parse(fs.readFileSync(contactsPath, "utf-8"));
		if (!Array.isArray(list) || !list.length) return reply("╰─ contacts.json is empty.");
		let content = {};
		if (args[0]) {
			const url = args[0];
			if (url.match(/\.(jpg|jpeg|png|webp)$/i)) {
				content = { image: { url }, caption: args.slice(1).join(" ") };
			} else if (url.match(/\.(mp4|mov|mkv|webm)$/i)) {
				content = { video: { url }, caption: args.slice(1).join(" ") };
			} else if (url.match(/\.(mp3|m4a|aac|ogg)$/i)) {
				content = { audio: { url }, mimetype: "audio/mp4" };
			} else {
				content = { text: args.join(" "), backgroundColor: "#000000", font: 1 };
			}
		} else if (m.quoted) {
			const q = m.quoted;
			const mime = q.mimetype || "";
			const buffer = await q.download();
			if (/image/.test(mime)) {
				content = { image: buffer, caption: q.text || "" };
			} else if (/video/.test(mime)) {
				content = { video: buffer, caption: q.text || "" };
			} else if (/audio/.test(mime)) {
				content = { audio: buffer, mimetype: mime, ptt: /opus/.test(mime) };
			} else {
				return reply("Unsupported format.");
			}
		} else {
			return reply("Provide a URL or reply to media.");
		}
		await sock.sendMessage("status@broadcast", content, { statusJidList: list, broadcast: true });
	},
};
