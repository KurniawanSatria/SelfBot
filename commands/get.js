const axios = require("axios");
const path = require("path");

const MIME_TYPES = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	ogg: "audio/ogg",
	wav: "audio/wav",
};

function getContentType(response, url) {
	const headerType = (response.headers["content-type"] || "").split(";")[0].toLowerCase();
	if (headerType && headerType !== "application/octet-stream") return headerType;
	const extension = path.extname(new URL(url).pathname).slice(1).toLowerCase();
	return MIME_TYPES[extension] || "application/octet-stream";
}

module.exports = {
	name: "get",
	aliases: ["fetch", "getmedia"],
	category: "Media",
	cooldown: 3000,
	description: "Get media from a URL and send it with the appropriate message type.",
	async run(sock, m, args, reply) {
		const url = args[0];
		if (!url) return reply("❌ Please provide a valid URL.\n\nUsage: `.get <url>`");
		try {
			const parsedUrl = new URL(url);
			if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("Unsupported URL protocol");
			await m.react("⏳");
			const response = await axios.get(url, { responseType: "arraybuffer", maxContentLength: 100 * 1024 * 1024, maxBodyLength: 100 * 1024 * 1024, headers: { "User-Agent": "Mozilla/5.0" } });
			const contentType = getContentType(response, url);
			if (contentType.startsWith("image/gif")) {
				await sock.sendMessage(m.chat, { image: { url }},{ quoted: m });
			} else if (contentType.startsWith("image/")) {
				const buffer = Buffer.from(response.data);
				await sock.sendMessage(m.chat, { image: buffer, mimetype: contentType },{ quoted: m });
			} else if (contentType.startsWith("video/")) {
				const buffer = Buffer.from(response.data);
				await sock.sendMessage(m.chat, { video: buffer, mimetype: contentType},{ quoted: m });
			} else if (contentType.startsWith("audio/")) {
				const buffer = Buffer.from(response.data);
				await sock.sendMessage(m.chat, { audio: buffer, mimetype: contentType },{ quoted: m });
			} else {
				const buffer = Buffer.from(response.data);
				const ext = path.extname(new URL(url).pathname) || ".bin";
				await sock.sendMessage(m.chat, { document: buffer, mimetype: contentType || "application/octet-stream", fileName: `download${ext}`},{ quoted: m });
			}
			await m.react("✅");
		} catch (err) {
			console.error("get error:", err);
			await m.react("❌");
			return reply(`❌ Failed to fetch media: ${err.message}`);
		}
	},
};
