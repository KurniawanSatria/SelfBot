const axios = require("axios");
const { Emojimix } = require("../lib/emojimix");

module.exports = {
	name: "emojimix",
	aliases: ["emix"],
	category: "Sticker",
	cooldown: 10000,
	description: "Mix two emojis into a sticker",
	async run(sock, m, args, reply, chat) {
		const [emoji1, emoji2] = args.join(" ").split("+").map((e) => e?.trim());
		if (!emoji1 || !emoji2) return reply(`❌ *Two emojis required.*\n\n*Usage:* .emojimix <emoji1>+<emoji2>\n\n*Example:*\n• .emojimix 😂+😭`);
		try {
			const url = await Emojimix(emoji1, emoji2);
			if (!url) return reply("❌ That emoji combination isn't available.");
			const { data } = await axios.get(url, { responseType: "arraybuffer" });
			await sock.sendImageAsSticker(chat, data, m);
		} catch (error) {
			console.error("[EMOJIMIX ERROR]", error);
			await reply("❌ Failed to generate emojimix sticker: " + error.message);
		}
	},
};
