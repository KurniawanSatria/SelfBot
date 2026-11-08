const { OWNER_NUMBERS } = require("../lib/config");
const db = require("../lib/database");

function isOwner(m) {
	const senderNumber = (m.sender || "").split("@")[0];
	return AUTHORIZED_NUMBERS.includes(senderNumber) || m.fromMe;
}

module.exports = {
	name: "unbanchat",
	aliases: ["unban"],
	description: "Unban this chat so the bot responds again",
	category: "Owner",
	cooldown: 3000,
	async run(sock, m, args, reply) {
		if (!isOwner(m)) return reply("╰─ This feature is owner-only.");
		const chat = m.key.remoteJid;
		const banned = await db.isChatBanned(chat);
		if (!banned) return reply("⌁ This chat is not banned.");
		await db.removeBannedChat(chat);
		return reply("◇ Chat Unbanned ⌁ Bot will resume responding to messages here.");
	},
};
