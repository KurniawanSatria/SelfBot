const search = require("yt-search");
const { Button, getBuffer } = require("../lib/helper");
const { downloadMP3, cleanupLocal } = require("../lib/yt");
const queue = require("../lib/queue");
const db = require("../lib/database");

module.exports = {
	name: "ytmp3",
	aliases: ["yta", "ytaudio"],
	category: "Downloader",
	cooldown: 10000,
	description: "Download YouTube video as MP3",

	async run(sock, m, args, reply, chat) {
		const query = args.join(" ").trim();
		if (!query) return reply("⌬ Usage  ›  .ytmp3 <YouTube URL / song title>");
		try {
			const result = await search(query);
			if (!result.videos?.length) return reply("╰─ No matching video found.");
			const video = result.videos[0];
			await new Button(sock)
				.setImage(await getBuffer(video.thumbnail))
				.setTitle(video.title)
				.setBody(`Artist › ${video.author.name}`)
				.setFooter("⌁ Downloading MP3...")
				.addUrl("YouTube", video.url)
				.send(m.chat, { quoted: m });
			queue.add("downloader", reply, async () => {
				try {
					const res = await downloadMP3(video.url);
					if (!res?.download_url && !res?.filePath && !res?.buffer) return reply("╰─ Failed to get MP3 download link.");
					const audio = res.buffer ? res.buffer : res.filePath ? { url: res.filePath } : { url: res.download_url };
					await sock.sendMessage(chat, { audio, mimetype: res.mime || "audio/mpeg", ptt: false, fileName: `${video.title}.mp3` }, { quoted: m });
					if (res.filePath) cleanupLocal(res.filePath);
					db.trackDownload(m.sender, m.pushName, "youtube").catch(() => {});
				} catch (error) {
					console.error("[YTMP3 ERROR]", error);
					await reply(`╰─ Download failed: ${error.message}`);
				}
			});
		} catch (error) {
			console.error("[YTMP3 ERROR]", error);
			await reply(`╰─ Download failed: ${error.message}`);
		}
	},
};
