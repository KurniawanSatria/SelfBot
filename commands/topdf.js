const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const fontkit = require("fontkit");

const BOT_ROOT = path.join(__dirname, "..");
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

module.exports = {
	name: "topdf",
	aliases: ["text2pdf", "pdf"],
	category: "Media",
	cooldown: 5000,
	description: "Convert replied text to PDF with a custom title.",
	async run(sock, m, args, reply, chat) {
		const text = m.quoted?.text?.trim();
		const title = args?.join(" ").trim() || "WhatsApp Text Export";
		if (!text) return reply("❌ Reply to a text message.\n\n*Usage:* `.topdf <title>`");
		try {
			const doc = await PDFDocument.create();
			doc.registerFontkit(fontkit);
			doc.setTitle(title);
			doc.setProducer("Saturia Selfbot");
			let font;
			try {
				font = await doc.embedFont(fs.readFileSync(FONT_PATH));
			} catch {
				font = await doc.embedFont(StandardFonts.Helvetica);
			}
			const pageSize = { w: 595.28, h: 841.89 };
			const margin = 50;
			const maxWidth = pageSize.w - margin * 2;
			const fontSize = 12;
			const lineHeight = fontSize * 1.5;
			const wrapLine = (line) => {
				const words = line.split(/\s+/);
				const lines = [];
				let current = "";
				for (const word of words) {
					const test = current ? `${current} ${word}` : word;
					if (font.widthOfTextAtSize(test, fontSize) > maxWidth && current) {
						lines.push(current);
						current = word;
					} else {
						current = test;
					}
				}
				if (current) lines.push(current);
				return lines.length ? lines : [""];
			};
			let page = doc.addPage([pageSize.w, pageSize.h]);
			let cursorY = pageSize.h - margin;
			page.drawText(title, { x: margin, y: cursorY, size: 18, font, color: { type: "RGB", red: 0.1, green: 0.1, blue: 0.1 } });
			cursorY -= 35;
			for (const paragraph of text.split(/\n+/)) {
				for (const line of wrapLine(paragraph)) {
					if (cursorY - lineHeight < margin) {
						page = doc.addPage([pageSize.w, pageSize.h]);
						cursorY = pageSize.h - margin;
					}
					page.drawText(line, { x: margin, y: cursorY, size: fontSize, font, color: { type: "RGB", red: 0.1, green: 0.1, blue: 0.1 }});
					cursorY -= lineHeight;
				}
				cursorY -= lineHeight * 0.5;
			}
			const pdfBytes = await doc.save();
			const tmpDir = path.join(BOT_ROOT, "tmp");
			const outFile = path.join(tmpDir, `text-${Date.now()}.pdf`);
			fs.mkdirSync(tmpDir, { recursive: true });
			fs.writeFileSync(outFile, pdfBytes);
			try {
				await sock.sendMessage(chat, { document: { url: outFile }, fileName: `${title}.pdf`, mimetype: "application/pdf", caption: `📄 ${title}` },{ quoted: m });
			} finally {
				fs.unlink(outFile, () => {});
			}
		} catch (err) {
			console.error("topdf error:", err);
			reply("❌ Failed to create PDF: " + err.message);
		}
	},
};
