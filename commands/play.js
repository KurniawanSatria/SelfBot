const search = require("yt-search");
const { Button, getBuffer } = require("../lib/helper");
const { downloadMP3, cleanupLocal } = require("../lib/yt.js");
const queue = require("../lib/queue");
const db = require("../lib/database");

module.exports = {
	name: "play",
	aliases: ["ytplay", "song"],
	category: "Downloader",
	cooldown: 10000,
	description:
		"Search YouTube and download audio using yt-dlp. .play <song title>",
	async run(sock, m, args, reply, chat) {
		const query = args.join(" ").trim();
		if (!query) return reply("⌬ Usage  ›  .play <song title>");
		try {
			const res = await search(query);
			if (!res.videos?.length) return reply("╰─ No matching video found.");
			const video = res.videos[0];
			queue.add(m.sender, reply, async () => {
				try {
					let { download_url, filePath, buffer, mime } = await downloadMP3(video.url);
					const audio = buffer ? buffer : filePath ? { url: filePath } : { url: download_url };
					await sock.sendMessage(chat, { audio, mimetype: mime || "audio/mpeg", ptt: false }, { quoted: m });
					if (filePath) cleanupLocal(filePath);
					db.trackDownload(m.sender, m.pushName, "youtube").catch(() => {});
				} catch (error) {
					console.error("[PLAY ERROR]", error);
					await reply(`╰─ Download failed: ${error.message}`);
				}
			});
			try {
				await new Button(sock)
					.setImage(await getBuffer(video.thumbnail))
					.setTitle(video.title)
					.setBody(`Artist › ${video.author.name}`)
					.setFooter("⌁ Downloading audio...")
					.addUrl("YouTube", video.url)
					.send(m.chat, { quoted: m });
			} catch (e) {
				console.error("[PLAY CARD]", e.message);
			}
		} catch (error) {
			console.error("[PLAY SEARCH ERROR]", error);
			await reply(`╰─ Search failed: ${error.message}`);
		}
	},
};
