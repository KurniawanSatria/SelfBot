const { Button } = require("../lib/helper");

const PREFIX = process.env.PREFIX || ".";
const { OWNER_NUMBERS: OWNERS } = require("../lib/config");
const ORDER = ["General", "Owner", "Tools", "Downloader", "Media", "AI", "Sticker", "Group", "Game", "Other"];
const MAX_SECTIONS = 10;
const MAX_ROWS = 100;

const rank = (c) => {
	const i = ORDER.indexOf(c);
	return i === -1 ? 99 : i;
};

function uptime() {
	const s = Math.floor(process.uptime());
	return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function build() {
	const mods = [...new Set(global.commands.values())].filter((x) => x?.name);
	const groups = new Map();
	for (const mod of mods) {
		const cat = mod.category || "Other";
		if (!groups.has(cat)) groups.set(cat, []);
		groups.get(cat).push(mod);
	}
	const cats = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
	const sections = [];
	let rows = 0;
	const plain = [];
	for (const cat of cats) {
		const items = groups.get(cat).sort((a, b) => a.name.localeCompare(b.name));
		plain.push(`「 ${cat.toUpperCase()} 」\n${items.map((c) => `${PREFIX}${c.name}`).join("  ")}`);
		if (sections.length >= MAX_SECTIONS || rows >= MAX_ROWS) continue;
		const take = items.slice(0, Math.min(10, MAX_ROWS - rows));
		sections.push({ cat, items: take });
		rows += take.length;
	}
	return { total: mods.length, sections, plain: plain.join("\n\n") };
}

module.exports = {
	name: "menu",
	aliases: ["help", "owner", "creator", "commands", "list"],
	category: "General",
	cooldown: 3000,
	description: "Show all commands or owner contact",
	async run(sock, m, args, reply) {
		const invoked = (m.body || "").slice(PREFIX.length).trim().split(/\s+/)[0].toLowerCase();
		if (["owner", "creator"].includes(invoked)) {
			if (!OWNERS.length) return reply("Owner is not configured.");
			const text = `「 OWNER 」\n\n${OWNERS.map((n) => `• wa.me/${n}`).join("\n")}`;
			return sock.sendMessage(m.chat, { text, mentions: OWNERS.map((n) => `${n}@s.whatsapp.net`) }, { quoted: m });
		}
		const { total, sections, plain } = build();
		const header = `Prefix › ${PREFIX}\nCommands › ${total}\nUptime › ${uptime()}`;
		const fallback = `「 ${process.env.STICKER_PACKNAME || "Shiroko Md"} 」\n${header}\n\n${plain}\n\n${global.footer || ""}`.trim();
		const btn = new Button(sock)
			.setTitle(process.env.STICKER_PACKNAME || "Shiroko Md")
			.setBody(header)
			.setFooter(global.footer || "")
			.addSelection("Choose a command");
		for (const { cat, items } of sections) {
			btn.makeSection(cat);
			for (const c of items) btn.makeRow("", `${PREFIX}${c.name}`, String(c.description || "").slice(0, 72), `${PREFIX}${c.name}`);
		}
		btn.setFallbackText(fallback);
		return btn.send(m.chat, { quoted: m });
	},
};