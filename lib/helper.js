const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { generateWAMessageFromContent, prepareWAMessageMedia } = require("baileys");

const execFileP = promisify(execFile);
const TMP = path.join(__dirname, "..", "tmp");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getRandom(ext = "") {
  try { fs.mkdirSync(TMP, { recursive: true }); } catch {}
  return path.join(TMP, `temp_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`);
}

async function getBuffer(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchJson(url, options = {}) {
  const { body, headers, ...rest } = options;
  const res = await fetch(url, {
    ...rest,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function ffmpegConvert(input, ext, args) {
  const out = getRandom(ext);
  await execFileP("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input, ...args, out]);
  return out;
}

const convertToPtt = (input) =>
  ffmpegConvert(input, ".ogg", ["-vn", "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", "-ac", "1", "-f", "ogg"]);
const convertToMp3 = (input) =>
  ffmpegConvert(input, ".mp3", ["-vn", "-c:a", "libmp3lame", "-b:a", "128k"]);
const convertToOgg = convertToPtt;

function sendAudio(sock, jid, buffer, ptt = false, options = {}) {
  return sock.sendAudio(jid, buffer, { ptt, ...options });
}

function bindWrapper(sock) {
  return sock;
}

async function sendStickerPack(sock, jid, data, options = {}) {
  const stickers = Array.isArray(data) ? data : [data];
  const sent = [];
  for (const s of stickers) sent.push(await sock.sendMessage(jid, { sticker: s }, options));
  return sent;
}

class Button {
  constructor(sock) {
    this.sock = sock;
    this.body = "";
    this.title = "";
    this.footer = "";
    this.data = null;
    this.params = {};
    this.buttons = [];
    this.sections = [];
    this._section = null;
    this.fallbackText = "";
  }

  setBody(t) { this.body = t; return this; }
  setTitle(t) { this.title = t; return this; }
  setFooter(t) { this.footer = t; return this; }
  setParams(p) { this.params = p; return this; }
  setFallbackText(t) { this.fallbackText = t; return this; }
  setImage(p, o = {}) { this.data = Buffer.isBuffer(p) ? { image: p, ...o } : { image: { url: p }, ...o }; return this; }
  setVideo(p, o = {}) { this.data = Buffer.isBuffer(p) ? { video: p, ...o } : { video: { url: p }, ...o }; return this; }
  setDocument(p, o = {}) { this.data = Buffer.isBuffer(p) ? { document: p, ...o } : { document: { url: p }, ...o }; return this; }
  setMedia(obj) { this.data = obj; return this; }

  addCopy(text, code) {
    this.buttons.push({ name: "cta_copy", params: { display_text: text, copy_code: String(code ?? "") } });
    return this;
  }

  addUrl(text, url) {
    this.buttons.push({ name: "cta_url", params: { display_text: text, url, merchant_url: url } });
    return this;
  }

  addReply(text, id) {
    this.buttons.push({ name: "quick_reply", params: { display_text: text, id } });
    return this;
  }

  addSelection(title) {
    this.sections = [];
    this._section = null;
    this.buttons.push({ name: "single_select", params: { title, sections: this.sections } });
    return this;
  }

  makeSection(title, highlight_label = "") {
    this._section = { title, highlight_label, rows: [] };
    this.sections.push(this._section);
    return this;
  }

  makeRow(header = "", title = "", description = "", id = "") {
    if (!this._section) this.makeSection("");
    this._section.rows.push({ header, title, description, id });
    return this;
  }

  _text() {
    return [this.title, this.body, this.footer].filter(Boolean).join("\n\n");
  }

  async _card() {
    let media = {};
    if (this.data && typeof prepareWAMessageMedia === "function") {
      try { media = await prepareWAMessageMedia(this.data, { upload: this.sock.waUploadToServer }); } catch {}
    }
    return {
      body: { text: this.body || "" },
      footer: this.footer ? { text: this.footer } : undefined,
      header: { title: this.title || "", hasMediaAttachment: !!this.data, ...media },
      nativeFlowMessage: {
        messageParamsJson: JSON.stringify(this.params || {}),
        buttons: this.buttons.map((b) => ({ name: b.name, buttonParamsJson: JSON.stringify(b.params) })),
      },
    };
  }

  async send(jid, options = {}) {
    const { quoted, ...rest } = options;
    const fallback = this.fallbackText || this._text();
    if (!this.buttons.length) return this.sock.sendMessage(jid, { text: fallback }, { quoted });
    try {
      const card = await this._card();
      const msg = generateWAMessageFromContent(jid, { interactiveMessage: card }, { userJid: this.sock.user?.id, quoted });
      await this.sock.relayMessage(jid, msg.message, {
        messageId: msg.key.id,
        additionalNodes: [
          {
            tag: "biz",
            attrs: {},
            content: [
              {
                tag: "interactive",
                attrs: { type: "native_flow", v: "1" },
                content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }],
              },
            ],
          },
        ],
        ...rest,
      });
      return msg;
    } catch {
      return this.sock.sendMessage(jid, { text: fallback }, { quoted });
    }
  }
}

class AIRich {
  constructor(sock) {
    this.sock = sock;
    this.parts = [];
    this.tip = "";
    this.suggests = [];
    this.code = null;
  }

  addText(t) { this.parts.push(t); return this; }
  addTip(t) { this.tip = t; return this; }
  addSuggest(s) { this.suggests = Array.isArray(s) ? s : [s]; return this; }
  addCode(lang, code) { this.code = { lang, code }; return this; }

  async send(jid, options = {}) {
    const lines = [...this.parts];
    if (this.tip) lines.push(this.tip);
    if (this.code) lines.push("```" + (this.code.lang || "") + "\n" + this.code.code + "\n```");
    if (this.suggests.length) lines.push(this.suggests.map((s) => `• ${s}`).join("\n"));
    return this.sock.sendMessage(jid, { text: lines.filter(Boolean).join("\n\n") }, options);
  }
}

module.exports = {
  sleep,
  getRandom,
  getBuffer,
  fetchJson,
  convertToPtt,
  convertToMp3,
  convertToOgg,
  sendAudio,
  bindWrapper,
  sendStickerPack,
  Button,
  AIRich,
};
