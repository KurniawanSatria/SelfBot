const axios = require("axios");

module.exports = {
	name: "quote",
	aliases: ["qimg", "quoteimage", "qc"],
	category: "Sticker",
	cooldown: 5000,
	description: "Generate a Telegram-style quote image from a message",
	async run(sock, m, args, reply, chat) {
		const text = (m.quoted?.text || args.join(" ")).trim();
		if (!text) return reply("Usage: .quote <text> or reply to a message with .quote");
		const senderJid = m.quoted?.sender || m.sender;
		const contact = sock.store?.contacts?.[senderJid];
		let name = m.quoted ? (m.quoted.fakeObj?.pushName || "") : (m.pushName || "");
		if (!name) { try { name = await sock.getName?.(senderJid); } catch {} }
		if (!name || name === senderJid) {
			try { const udb = await require("../lib/database").getUser(senderJid); if (udb?.name) name = udb.name; } catch {}
		}
		if (!name || name === senderJid) name = contact?.name || contact?.notify || senderJid.split("@")[0];
		let avatarUrl = null;
		try { avatarUrl = await sock.profilePictureUrl(senderJid, "image"); } catch {}
		if (!avatarUrl) avatarUrl = "https://i.pinimg.com/736x/15/46/d1/1546d15ce5dd2946573b3506df109d00.jpg";
		const payload = {
			backgroundColor: "#1b1429",
			width: 512,
			scale: 2,
			messages: [
				{
					from: { id: 1, name, photo: { url: avatarUrl } },
					text,
					avatar: true,
					replyMessage: m.quoted?.quoted?.text ? { name: "Reply", text: m.quoted.quoted.text.slice(0, 100), chatId: 1 } : undefined,
				},
			],
		};
		try {
			const { data } = await axios.post("https://quote.yuri.ly/generate", payload, { timeout: 30000 });
			if (!data?.ok || data?.error) return reply("Error: " + (data?.error?.message || "failed"));
			const buf = Buffer.from(data.result.image, "base64");
			if (typeof sock.sendImageAsSticker === "function") return sock.sendImageAsSticker(chat, buf, m);
			await sock.sendMessage(chat, { sticker: buf }, { quoted: m });
		} catch (e) {
			return reply("Failed to generate quote: " + e.message);
		}
	},
};
