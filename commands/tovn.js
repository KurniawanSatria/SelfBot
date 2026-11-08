const { downloadMediaMessage, getContentType } = require("baileys");
const { sendAudio, getBuffer } = require("../lib/helper");

module.exports = {
	name: "toptt",
	aliases: ["tovn"],
	description: "Convert audio to voice note (PTT)",
	category: "Media",
	cooldown: 5000,
	async run(sock, m, args, reply) {
		try {
			const msg = m.quoted?.msg || m.msg;
			if (!msg?.mimetype || !/video/i.test(msg.mimetype)) return reply("╰─ Reply to a video message to extract its audio.");
			await m.react("⏳");
			const media = await sock.downloadMediaMessage(msg);
			await sendAudio(sock, m.key.remoteJid, media, true, { quoted: m });
			await m.react("✅");
		} catch (err) {
			console.error("sticker error:", err.message);
			await m.react("❌");
			reply("❌ Conversion failed: " + err.message);
		}
	},
};
