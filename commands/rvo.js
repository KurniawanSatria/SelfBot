const fs = require("fs");
const { getContentType, downloadMediaMessage } = require("baileys");
const { getRandom, convertToOgg } = require("../lib/helper");

module.exports = {
	name: "rvo",
	aliases: ["reavo", "viewonce", "vo"],
	description: "Bypass Viewonce (image/video/audio)",
	category: "Media",
	cooldown: 5000,
	async run(sock, m, args, reply) {
		if (!m.message?.extendedTextMessage?.contextInfo?.quotedMessage) return reply("╰─ Reply to a view-once message first.");
		const quoted = m.message.extendedTextMessage.contextInfo;
		const quotedMsg = quoted.quotedMessage;
		const quotedType = getContentType(quotedMsg);
		const voTypes = ["imageMessage", "videoMessage", "audioMessage"];
		if (!voTypes.includes(quotedType)) return reply("❌ Not a view-once message (image/video/audio)!");
		const cloned = JSON.parse(JSON.stringify(quotedMsg));
		if (cloned[quotedType]?.viewOnce) cloned[quotedType].viewOnce = false;
		const fakeMsg = { key: { remoteJid: m.key.remoteJid, fromMe: false, id: quoted.stanzaId, participant: quoted.participant, }, message: cloned };
		try {
			await sock.sendMessage(m.chat, { forward: fakeMsg, contextInfo: { forwardingScore: 999, isForwarded: true } }, { quoted: m });
		} catch (e) {
			reply("╰─ Failed to open view-once message: " + e.message);
		}
	},
};
