const ENABLE_CUSTOM_MUSIC = true;
const DEFAULT_MUSIC = {
	musicContentMediaId: "12",
	songId: "11",
	author: "Saturiaa",
	title: "Shiroko Multi Device",
	artistAttribution: "https://satzz.online",
	isExplicit: false,
	artworkDirectPath: "",
	artworkSha256: "",
	artworkEncSha256: "",
	artworkMediaKey: "",
};
function buildMusicAnnotation(music) {
	return {
		polygonVertices: [],
		embeddedContent: {
			embeddedMusic: {
				musicContentMediaId: music.musicContentMediaId || "0",
				songId: music.songId || "0",
				author: music.author || "",
				title: music.title || "",
				artworkDirectPath: music.artworkDirectPath || "",
				artworkSha256: music.artworkSha256 || "",
				artworkEncSha256: music.artworkEncSha256 || "",
				artistAttribution: music.artistAttribution || "",
				countryBlocklist: "",
				isExplicit: !!music.isExplicit,
				artworkMediaKey: music.artworkMediaKey || "",
				musicSongStartTimeInMs: { low: 0, high: 0, unsigned: false },
				derivedContentStartTimeInMs: { low: 0, high: 0, unsigned: false },
				overlapDurationInMs: { low: 0, high: 0, unsigned: false },
			},
		},
		embeddedAction: true,
		shouldSkipConfirmation: true,
	};
}

function findMediaNode(rawMsg, depth = 0) {
	if (!rawMsg || depth > 5) return null;
	if (rawMsg.videoMessage) return { node: rawMsg.videoMessage };
	if (rawMsg.imageMessage) return { node: rawMsg.imageMessage };
	if (rawMsg.audioMessage) return { node: rawMsg.audioMessage };
	if (rawMsg.documentMessage) return { node: rawMsg.documentMessage };
	const wrappers = [
		"ephemeralMessage",
		"viewOnceMessage",
		"viewOnceMessageV2",
		"viewOnceMessageV2Extension",
		"documentWithCaptionMessage",
	];
	for (const w of wrappers) {
		if (rawMsg[w]?.message) {
			const found = findMediaNode(rawMsg[w].message, depth + 1);
			if (found) return found;
		}
	}
	return null;
}

function injectGroupStatusContextInfo(rawMsg, audienceType) {
	const traverseAndSet = (node) => {
		if (!node) return;
		const supportedTypes = [
			"extendedTextMessage",
			"conversation",
			"imageMessage",
			"videoMessage",
			"audioMessage",
			"documentMessage",
		];
		for (const type of supportedTypes) {
			const target = node[type];
			if (target && typeof target === "object") {
				if (!target.contextInfo) target.contextInfo = {};
				target.contextInfo.isGroupStatus = true;
				target.contextInfo.forwardingScore = 0;
				target.contextInfo.statusAttributions = audienceType
					? []
					: [{ type: 4 }];
				target.contextInfo.featureEligibilities = {
					cannotBeRanked: false,
					canBeReshared: true,
					canReceiveMultiReact: true,
				};
				target.contextInfo.statusSourceType = 4;
				target.contextInfo.statusAudienceMetadata = { audienceType };
				if (type === "extendedTextMessage" || type === "conversation") {
					target.textArgb = 4294967295;
					target.backgroundArgb = 4286484643;
					target.font = 0;
					target.previewType = 0;
				}
				break;
			}
		}
	};

	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		traverseAndSet(node);
		for (const key of Object.keys(node)) {
			const val = node[key];
			if (val && typeof val === "object") {
				if (val.message) walk(val.message);
				if (Array.isArray(val)) val.forEach(walk);
			}
		}
	};
	walk(rawMsg);
}

function wrapGroupStatusMessage(content) {
	let wrapped = { groupStatusMessageV2: { message: content } };
	for (let i = 0; i < 5; i++) {
		wrapped = { groupStatusMessageV2: { message: wrapped } };
	}
	return wrapped;
}

function parseArgs(raw) {
	const result = {
		caption: raw,
		listName: "Close Friends",
		listEmoji: "⭐",
		audienceType: 1,
	};
	if (!raw) return result;
	const pipeIdx = raw.lastIndexOf("|");
	if (pipeIdx <= 0) return result;
	const captionPart = raw.slice(0, pipeIdx).trim();
	const afterPipe = raw.slice(pipeIdx + 1);
	const colonIdx = afterPipe.lastIndexOf(":");
	if (colonIdx <= 0) return result;
	const emojiPart = afterPipe.slice(0, colonIdx).trim();
	const listPart = afterPipe.slice(colonIdx + 1).trim();
	const emojiMatch = emojiPart.match(/^([\p{Emoji_Presentation}\p{Emoji}]+)$/u);
	if (!emojiMatch) return result;
	result.caption = captionPart;
	result.listEmoji = emojiMatch[1];
	result.listName = listPart || "Close Friends";
	result.audienceType = 1;
	return result;
}

function overrideCaption(rawMsg, caption) {
	if (!caption) return;
	const setText = (node) => {
		if (node.extendedTextMessage) node.extendedTextMessage.text = caption;
		if (node.conversation) node.conversation = caption;
		if (node.imageMessage) node.imageMessage.caption = caption;
		if (node.videoMessage) node.videoMessage.caption = caption;
		if (node.documentMessage) node.documentMessage.caption = caption;
	};

	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		setText(node);
		for (const key of Object.keys(node)) {
			const val = node[key];
			if (val && typeof val === "object") {
				if (val.message) walk(val.message);
				if (Array.isArray(val)) val.forEach(walk);
			}
		}
	};
	walk(rawMsg);
}

module.exports = {
	name: "statusgc",
	aliases: ["swgc"],
	category: "Group",
	cooldown: 5000,

	async run(sock, m, args, reply) {
		const { generateMessageID } = require("baileys");
		let quotedRaw =
			m.quoted?.fakeObj?.message || m.quoted?.msg || m.raw?.message;
		const rawText = args.join(" ") || "";
		const parsed = parseArgs(rawText);
		if (!quotedRaw && !parsed.caption)
			return await m.reply(
				"「 GROUP STATUS 」\n\n" +
					"⌬ Usage\n" +
					"├ .swgc <text>\n" +
					"├ .swgc <text>|😀:Close Friends\n" +
					"╰ Reply to an image, video, or audio with .swgc",
			);
		await m.react("⏳");
		if (!quotedRaw) {
			quotedRaw = {
				extendedTextMessage: {
					text: parsed.caption,
					contextInfo: {},
					textArgb: 4294967295,
					backgroundArgb: 4286484643,
					font: 0,
					previewType: 0,
				},
			};
		} else if (parsed.caption) {
			overrideCaption(quotedRaw, parsed.caption);
		}

		injectGroupStatusContextInfo(quotedRaw, parsed.audienceType);
		let musicInfo = null;
		if (ENABLE_CUSTOM_MUSIC) {
			musicInfo = { ...DEFAULT_MUSIC };
			const media = findMediaNode(quotedRaw);
			if (media) {
				const existing = Array.isArray(media.node.annotations)
					? media.node.annotations
					: [];
				const withoutOldMusic = existing.filter(
					(a) => !a?.embeddedContent?.embeddedMusic,
				);
				media.node.annotations = [
					...withoutOldMusic,
					buildMusicAnnotation(musicInfo),
				];
			} else {
				musicInfo = null;
			}
		}

		const wrapped = wrapGroupStatusMessage(quotedRaw);
		await sock.relayMessage(m.chat, wrapped, {
			messageId: generateMessageID(),
		});
		await m.react("✅");
	},
};
