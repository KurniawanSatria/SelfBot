const { downloadMediaMessage, getContentType } = require("baileys");
const { sendAudio } = require("../lib/helper");

module.exports = {
	name: "topmp3",
	aliases: ["toaud"],
	description: "Convert a replied video into MP3 audio",
	category: "Media",
	cooldown: 5000,

	async run(sock, m, args, reply) {
		try {
			const msg = m.quoted?.msg || m.msg;
			if (!msg?.mimetype || !/video/i.test(msg.mimetype)) return reply("╰─ Reply to a video message to extract its audio.");
			await m.react("⏳");
			const media = await sock.downloadMediaMessage(msg);
			await sendAudio(sock, m.key.remoteJid, media, false, { quoted: m });
			await m.react("✅");
		} catch (err) {
			console.error("[TOPMP3 ERROR]", err);
			await m.react("❌").catch(() => {});
			await reply(`╰─ Conversion failed: ${err.message}`);
		}
	},
};
