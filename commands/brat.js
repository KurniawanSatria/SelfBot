const axios = require("axios");

const API = "https://api.nexray.eu.cc/maker/brathd?text=";

module.exports = {
	name: "brat",
	aliases: ["bratgen"],
	category: "Sticker",
	cooldown: 10000,
	description: "Generate brat-style stickers",
	async run(sock, m, args, reply, chat) {
		const text = args.join(" ").trim();
		if (!text)
			return reply(`❌ *Text is required.*\n\n*Usage:* .brat <text>\n\n*Example:*\n• .brat leave me alone`);
		try {
			const { data } = await axios.get(API + encodeURIComponent(text), { responseType: "arraybuffer", timeout: 120000 });
			return sock.sendImageAsSticker(chat, data, m);
		} catch (error) {
			console.error("[BRAT ERROR]", error);
			await reply("❌ Failed to generate brat sticker: " + error.message);
		}
	},
};
