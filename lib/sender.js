const { getBuffer, Button } = require("./helper");
const { stripEmoji } = require("./text");

const VALID_TYPES = [
  "text", "image", "video", "audio", "voice", "document", "sticker",
  "location", "contact", "react", "poll", "album", "button",
];

async function resolveMedia(m, source) {
  const src = String(source || "").trim();
  if (!src) throw new Error("media source is empty");
  if (/^https?:\/\//i.test(src)) return src;
  if (src === "quoted" || src === "reply") {
    if (!m.quoted) throw new Error("no quoted message to take media from");
    return m.quoted.download();
  }
  throw new Error("media source must be an http(s) URL or 'quoted'");
}

async function send(sock, m, args, messageId) {
  const type = String(args.type || "").toLowerCase();
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`unsupported type '${type}', allowed: ${VALID_TYPES.join(", ")}`);
  }
  const chat = m.chat;
  const caption = args.caption ? stripEmoji(args.caption) : undefined;
  const quoted = { quoted: m, messageId };

  switch (type) {
    case "text":
      await sock.sendMessage(chat, { text: stripEmoji(args.text) }, quoted);
      return "text sent";
    case "image":
      await sock.sendMessage(chat, { image: await resolveMedia(m, args.url || args.source), caption }, quoted);
      return "image sent";
    case "video":
      await sock.sendMessage(chat, { video: await resolveMedia(m, args.url || args.source), caption }, quoted);
      return "video sent";
    case "audio": {
      const buf = await resolveMedia(m, args.url || args.source);
      await sock.sendAudio(chat, buf, { ptt: false, messageId });
      return "audio sent";
    }
    case "voice": {
      const buf = await resolveMedia(m, args.url || args.source);
      await sock.sendAudio(chat, buf, { ptt: true, messageId });
      return "voice note sent";
    }
    case "document": {
      const buf = await resolveMedia(m, args.url || args.source);
      await sock.sendMessage(chat, {
        document: buf,
        fileName: String(args.filename || "file"),
        mimetype: String(args.mimetype || "application/octet-stream"),
        caption,
      }, quoted);
      return "document sent";
    }
    case "sticker": {
      const src = args.url || args.source;
      const target = /^https?:\/\//i.test(String(src || "")) ? src : await resolveMedia(m, src);
      await sock.sendImageAsSticker(chat, target, m);
      return "sticker sent";
    }
    case "location":
      await sock.sendMessage(chat, {
        location: { degreesLatitude: Number(args.latitude), degreesLongitude: Number(args.longitude) },
      }, quoted);
      return "location sent";
    case "contact":
      await sock.sendMessage(chat, {
        contacts: {
          displayName: String(args.name || "Contact"),
          contacts: [{ vcard: String(args.vcard || "") }],
        },
      }, quoted);
      return "contact sent";
    case "react":
      await m.react(String(args.emoji || "👍"));
      return "reaction sent";
    case "poll": {
      const options = Array.isArray(args.options) ? args.options.map(String).filter(Boolean) : [];
      if (!options.length) throw new Error("poll needs at least one option");
      await sock.sendMessage(chat, {
        poll: {
          name: String(args.question || "Poll"),
          values: options,
          selectableCount: Number(args.selectable || 1),
        },
      }, quoted);
      return "poll sent";
    }
    case "album": {
      const urls = Array.isArray(args.urls) ? args.urls : [];
      if (!urls.length) throw new Error("album needs at least one url");
      await sock.albumMessage(chat, urls.map((u) => ({ image: { url: String(u) } })), m);
      return "album sent";
    }
    case "button": {
      const button = new Button(sock);
      button.setBody(String(args.text || ""));
      if (args.title) button.setTitle(String(args.title));
      if (args.footer) button.setFooter(String(args.footer));
      for (const b of Array.isArray(args.buttons) ? args.buttons : []) {
        if (b.url) button.addUrl(String(b.label || b.url), String(b.url));
        else if (b.copy) button.addCopy(String(b.label || b.copy), b.copy);
        else button.addReply(String(b.label || b.id || "OK"), String(b.id || b.label || "ok"));
      }
      await button.send(chat, { quoted: m });
      return "button sent";
    }
    default:
      throw new Error(`unsupported type '${type}'`);
  }
}

module.exports = { send, VALID_TYPES };
