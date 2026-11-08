module.exports = {
	name: "quoted",
	aliases: ["q", "qmsg"],
	description: "get deleted quoted message",
	category: "Tools",
	cooldown: 1000,
	async run(sock, m, args, reply) {
		if (!m.quoted) return m.reply("Reply to a message.");

		const findStored = async (id) => {
			if (!id) return null;
			const jids = [...new Set([m.key.remoteJid, m.chat, m.quoted.chat].filter(Boolean))];
			if (typeof sock.store?.loadMessage === "function") {
				for (const jid of jids) {
					try {
						const found = await sock.store.loadMessage(jid, id);
						if (found) return found;
					} catch { }
				}
			}
			const pool = sock.store?.messages;
			if (pool && typeof pool === "object") {
				const list = pool instanceof Map ? [...pool.values()] : Object.values(pool);
				const hit = list.find((x) => x?.key?.id === id);
				if (hit) return hit;
			}
			return null;
		};

		let ref = await findStored(m.quoted.id);
		let stanzaId = Object.values(ref?.message || {}).find((v) => v?.contextInfo)?.contextInfo?.stanzaId;
		if (!stanzaId) stanzaId = m.quoted.msg?.contextInfo?.stanzaId;
		if (!stanzaId) return m.reply("The parent quote has no stanzaId (is it not a reply?).");

		const send = async (target) => {
			try {
				return await m.reply({ forward: target, force: true });
			} catch (e) {
				return m.reply(`Forwarding failed: ${e.message}`);
			}
		};
		const goal = await findStored(stanzaId);
		if (goal?.message) return send(goal);

		const fake = m.quoted?.quoted?.fakeObj;
		if (fake) return send(fake);

		return m.reply("Message not found in the local store (the message may be older than the saved data or was not flushed before restart).");
	},
}
