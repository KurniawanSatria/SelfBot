const { getContentType, proto } = require("baileys");
const util = require("util");

function cleanJid(conn, jid, altJid) {
  return altJid || jid || "";
}

async function lidToJid(sock, jid) {
  if (!jid?.endsWith("@lid")) return jid || "";
  try {
    const pn = await sock.signalRepository.lidMapping.getPNForLID(jid);
    return pn?.replace(/:\d+(?=@)/, "") || jid;
  } catch {
    return jid;
  }
}

async function lidsToJids(sock, list) {
  return Promise.all((Array.isArray(list) ? list : []).map((j) => lidToJid(sock, j)));
}

function getNumber(jid) {
  return jid?.split("@")[0]?.split(":")[0] || "";
}

function replaceMentionText(text, from, to) {
  let out = text || "";
  for (let i = 0; i < from.length; i++) {
    const a = getNumber(from[i]);
    const b = getNumber(to[i]);
    if (a && b && a !== b) out = out.split("@" + a).join("@" + b);
  }
  return out;
}

function isSelf(sock, jid) {
  const target = getNumber(jid);
  if (!target) return false;
  return target === getNumber(sock.user?.id) || target === getNumber(sock.user?.lid);
}

async function findStored(store, jids, id) {
  if (!id) return null;
  if (typeof store?.loadMessage === "function") {
    for (const jid of jids) {
      try {
        const found = await store.loadMessage(jid, id);
        if (found) return found;
      } catch { }
    }
  }
  const pool = store?.messages;
  if (pool && typeof pool === "object") {
    const list = pool instanceof Map ? [...pool.values()] : Object.values(pool);
    const hit = list.find((x) => x?.key?.id === id);
    if (hit) return hit;
  }
  return null;
}

function getBody(msg) {
  if (!msg) return "";
  let iid = "";
  try {
    const pj = msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    if (pj) iid = JSON.parse(pj)?.id ?? "";
  } catch { }

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.templateButtonReplyMessage?.selectedId ||
    msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
    iid ||
    ""
  );
}

async function buildQuoted(sock, M, rawQuoted, ctx, fallbackChat, fallbackSender, parent) {
  if (!rawQuoted || !ctx) return null;

  const qtype = Object.keys(rawQuoted)[0];
  let qmsg = rawQuoted[qtype];
  if (qtype === "productMessage") qmsg = qmsg?.[Object.keys(qmsg || {})[0]];
  if (typeof qmsg === "string") qmsg = { text: qmsg };

  let qParticipant = cleanJid(sock, ctx.participant, ctx.participantAlt) || fallbackSender;
  qParticipant = await lidToJid(sock, qParticipant);
  const qChat = cleanJid(sock, ctx.remoteJid, ctx.remoteJidAlt) || fallbackChat;
  const qIsGroup = qChat?.endsWith("@g.us") ?? false;
  const qFromMe = isSelf(sock, qParticipant);

  const fakeObj = M.fromObject({
    key: {
      remoteJid: qChat,
      fromMe: qFromMe,
      id: ctx.stanzaId,
      ...(qIsGroup ? { participant: qParticipant } : {})
    },
    message: rawQuoted
  });

  const rawQText =
    qmsg?.text || qmsg?.caption || qmsg?.conversation || qmsg?.contentText ||
    qmsg?.selectedDisplayText || qmsg?.title || "";

  const rawQMentions = qmsg?.contextInfo?.mentionedJid || [];
  const qMentions = await lidsToJids(sock, rawQMentions);
  const qText = replaceMentionText(rawQText, rawQMentions, qMentions);

  return {
    text: qText,
    type: qtype,
    msg: qmsg,
    id: ctx.stanzaId,
    chat: qChat,
    sender: qParticipant,
    senderNumber: getNumber(qParticipant),
    fromMe: qFromMe,
    name: "",
    mentionedJid: qMentions,
    fakeObj,
    forward: (jid = fallbackChat, force = true, opts = {}) => sock.sendMessage(jid, { forward: fakeObj, force, ...opts }, { quoted: parent }),
    delete: () => sock.sendMessage(qChat, { delete: fakeObj.key }),
    download: () => sock.downloadMediaMessage(fakeObj),
    copyNForward: (jid = fallbackChat, force = false, opts = {}) => sock.copyNForward(jid, fakeObj, force, opts),
  };
}

async function serialize(sock, m, store) {
  if (!m || !sock) return m;
  const M = proto.WebMessageInfo;
  store = store || sock.store;
  try {
    m = M.create(m);
  } catch {
  }

  if (!m.key) return m;
  m.id = m.key.id;
  m.isBaileys = m.id?.startsWith("BAE5") && m.id.length === 16;
  m.fromMe = m.key.fromMe;
  m.pushName = m.pushName ?? "";
  m.rawChat = m.key.remoteJid || "";
  m.chat = cleanJid(sock, m.key.remoteJid, m.key.remoteJidAlt);
  m.isGroup = m.chat?.endsWith("@g.us") ?? false;
  m.isPrivate = !m.isGroup;
  m.sender = m.isGroup ? cleanJid(sock, m.key.participant, m.key.participantAlt) : cleanJid(sock, m.key.remoteJid, m.key.remoteJidAlt);
  m.sender = await lidToJid(sock, m.sender);
  m.participant = m.sender;
  if (!m.message) return m;
  m.mtype = getContentType(m.message);
  m.msg = m.message[m.mtype];
  m.type = m.mtype;

  const rawMentions = m.msg?.contextInfo?.mentionedJid || [];
  m.mentionedJid = await lidsToJids(sock, rawMentions);

  const rawBody = getBody(m.message) || m.msg?.text || m.msg?.caption || m.msg?.contentText || m.msg?.selectedDisplayText || m.msg?.title || "";
  m.body = replaceMentionText(rawBody, rawMentions, m.mentionedJid);
  m.text = m.body;

  if (m.chat === "status@broadcast" && ["protocolMessage", "senderKeyDistributionMessage"].includes(m.mtype)) {
    const fixed = cleanJid(sock, m.key.remoteJid, m.key.remoteJidAlt);
    m.chat = fixed !== "status@broadcast" ? fixed : m.sender;
  }
  if (m.mtype === "protocolMessage" && m.msg?.key) {
    const rjid = cleanJid(sock, m.msg.key.remoteJid, m.msg.key.remoteJidAlt);
    m.msg.key.remoteJid = rjid === "status@broadcast" ? m.chat : rjid;
    m.msg.key.participant = cleanJid(sock, m.msg.key.participant, m.msg.key.participantAlt) || "status_me";
    m.msg.key.fromMe = m.msg.key.participant === sock.user?.id;
    if (!m.msg.key.fromMe && m.msg.key.remoteJid === sock.user?.id) {
      m.msg.key.remoteJid = m.sender;
    }
  }
  const ctx = m.msg?.contextInfo;
  m.quoted = await buildQuoted(sock, M, ctx?.quotedMessage ?? null, ctx, m.chat, m.sender, m);
  if (m.quoted) {
    const qctx = m.quoted.msg?.contextInfo;
    m.quoted.quoted = (await buildQuoted(
      sock, M,
      qctx?.quotedMessage ?? null,
      qctx,
      m.quoted.chat,
      m.quoted.sender,
      m
    )) ?? null;
  }

  m.isQuoted = !!m.quoted;
  m.isQuotedQuoted = !!m.quoted?.quoted;
  m.quotedBody = m.quoted?.text ?? "";
  m.quotedType = m.quoted?.type ?? "";
  m.getQuotedObj = m.getQuotedMessage = async () => {
    if (!m.quoted?.id) return null;
    if (store?.loadMessage) {
      const jids = [...new Set([m.key.remoteJid, m.key.remoteJidAlt, m.chat, m.quoted.chat].filter(Boolean))];
      for (const jid of jids) {
        try {
          const q = await store.loadMessage(jid, m.quoted.id);
          if (q) return serialize(sock, q, store);
        } catch { }
      }
      try {
        const q = await store.loadMessage(m.quoted.id);
        if (q) return serialize(sock, q, store);
      } catch { }
    }
    return m.quoted.fakeObj ? serialize(sock, m.quoted.fakeObj, store) : null;
  };
  if (m.msg?.url) m.download = () => sock.downloadMediaMessage(m);
  m.reply = (content, options = {}, sendOpts = {}) => {
    const { newsletterJid, newsletterName } = process.env;
    const payload = typeof content === "string"
      ? {
        text: content,
        secureMetaServiceLabel: true,
        contextInfo: {
          // isForwarded: true,
          // forwardingScore: 999,
          // forwardedNewsletterMessageInfo: {
          //   newsletterJid,
          //   newsletterName,
          //   serverMessageId: 123,
          //   contentType: 1,
          // },
          ...options.contextInfo
        },
        ...options
      }
      : {
        ...content,
        ...options,
        contextInfo: {
          // isForwarded: true,
          // forwardingScore: 999,
          // forwardedNewsletterMessageInfo: {
          //   newsletterJid,
          //   newsletterName: "Saturiaaa.",
          //   serverMessageId: 123,
          //   contentType: 1,
          //   accessibilityText: "Saturiaaa.",
          //   profileName: "Saturiaaa."
          // },
          ...content.contextInfo,
          ...options.contextInfo
        }
      };

    return sock.sendMessage(m.chat, payload, { quoted: m, ...sendOpts });
  };
  m.forward = (jid = m.chat, force = true, opts = {}) => sock.sendMessage(jid, { forward: m, force, ...opts });
  m.react = (emoji) => sock.sendMessage(m.chat, { react: { text: emoji, key: m.key } });
  m.delete = () => sock.sendMessage(m.chat, { delete: m.key });
  m.copy = async () => serialize(sock, M.fromObject(M.toObject(m)), store);
  m.copyNForward = (jid = m.chat, force = false, opts = {}) => sock.copyNForward(jid, m, force, opts);
  m[util.inspect.custom] = function () {
    return {
      text: this.text,
      type: this.type,
      id: this.id,
      chat: this.chat,
      sender: this.sender,
      senderNumber: getNumber(this.sender),
      fromMe: this.fromMe,
      name: this.pushName || "",
      mentionedJid: this.mentionedJid || [],
      quoted: this.quoted
        ? {
          text: this.quoted.text,
          type: this.quoted.type,
          mimetype: this.quoted.msg?.mimetype || "",
          id: this.quoted.id,
          chat: this.quoted.chat,
          sender: this.quoted.sender,
          senderNumber: getNumber(this.quoted.sender),
          fromMe: this.quoted.fromMe,
          mentionedJid: this.quoted.mentionedJid || [],
          quoted: this.quoted.quoted ? { text: this.quoted.quoted.text, type: this.quoted.quoted.type, sender: this.quoted.quoted.sender } : null,
        }
        : null,
    };
  };

  return m;
}

module.exports = { serialize, lidToJid, lidsToJids };