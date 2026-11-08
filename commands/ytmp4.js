const search = require("yt-search");
const { Button, getBuffer } = require("../lib/helper");
const { downloadMP4, cleanupLocal } = require("../lib/yt");
const queue = require("../lib/queue");
const db = require("../lib/database");

module.exports = {
	name: "ytmp4",
	aliases: ["ytv", "ytvideo"],
	category: "Downloader",
	cooldown: 10000,
	description: "Download YouTube video as MP4",

	async run(sock, m, args, reply, chat) {
		const query = args.join(" ").trim();
		if (!query) return reply("⌬ Usage  ›  .ytmp4 <YouTube URL / video title>");
		try {
			const result = await search(query);
			if (!result.videos?.length) return reply("╰─ No matching video found.");
			const video = result.videos[0];
			await new Button(sock)
				.setImage(await getBuffer(video.thumbnail))
				.setTitle(video.title)
				.setBody(`Channel › ${video.author.name}`)
				.setFooter("⌁ Downloading MP4...")
				.addUrl("YouTube", video.url)
				.send(m.chat, { quoted: m });
			queue.add("downloader", reply, async () => {
				try {
					const res = await downloadMP4(video.url);
					if (!res?.download_url && !res?.filePath && !res?.buffer) return reply("╰─ Failed to get MP4 download link.");
					const media = res.buffer ? res.buffer : res.filePath ? { url: res.filePath } : { url: res.download_url };
					await sock.sendMessage(chat, { video: media, mimetype: res.mime || "video/mp4", fileName: `${video.title}.mp4` }, { quoted: m });
					if (res.filePath) cleanupLocal(res.filePath);
					db.trackDownload(m.sender, m.pushName, "youtube").catch(() => {});
				} catch (error) {
					console.error("[YTMP4 ERROR]", error);
					await reply(`╰─ Download failed: ${error.message}`);
				}
			});
		} catch (error) {
			console.error("[YTMP4 ERROR]", error);
			await reply(`╰─ Download failed: ${error.message}`);
		}
	},
};
