module.exports = {
	name: "hidetag",
	aliases: ["ht", "h"],
	category: "Group",
	description: "Mention all group members",
	async run(sock, m, args, reply) {
		if (!m.isGroup) return reply("❌ This command can only be used in groups.");
		const groupMetadata = await sock.groupMetadata(m.chat).catch(() => null);
		if (!groupMetadata) return reply("❌ Failed to get group metadata.");
		const participants = groupMetadata.participants;
		const text = args.join(" ");
		await sock.sendMessage(m.chat, { text: m.quoted ? m.quoted.text : text || "", mentions: participants.map((a) => a.id) }, { quoted: m });
	},
};
