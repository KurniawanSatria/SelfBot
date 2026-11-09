const db = require("../lib/database");
const util = require("node:util");
const { proto } = require("baileys");
const { exec } = require("node:child_process");
const { serialize } = require("../lib/serialize");
const { instagram, ttsave, instaDL, twitter } = require("../lib/downloader");
const ai = require("../lib/ai");
const shell = require("../lib/shell");

const PREFIX = process.env.PREFIX || ".";
const COOLDOWN = {
  DEFAULT: 1000,
  DOWNLOADER: 2000,
  STICKER: 300,
};
const FEATURES = {
  AUTO_DOWNLOAD: process.env.AUTO_DOWNLOAD === "true",
  AUTO_READ: process.env.AUTO_READ === "true",
  ANTI_DELETE: process.env.ANTI_DELETE === "true",
  AUTO_REJECT_CALL: process.env.AUTO_REJECT_CALL === "true",
};

const DEFAULT_COOLDOWN = 1000;
const cooldowns = new Map();

function isOnCooldown(sender, cmd, cooldownMs) {
  const key = `${sender}:${cmd}`;
  const last = cooldowns.get(key) ?? 0;
  const remaining = cooldownMs - (Date.now() - last);
  if (remaining > 0) return remaining;
  cooldowns.set(key, Date.now());
  return 0;
}

setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, ts] of cooldowns) {
    if (ts < cutoff) cooldowns.delete(key);
  }
}, 600_000);

const URL_REGEX = /https?:\/\/(?:[^\s]*\.)?(?:tiktok\.com|instagram\.com|(?:(?:vx|fx)?twitter|x)\.com)\/[^\s]+/i;

async function handleAutoDownload(sock, m) {
  if (!FEATURES.AUTO_DOWNLOAD || !m.fromMe) return;
  const url = m.body?.match(URL_REGEX)?.[0];
  if (!url) return;
  const remaining = isOnCooldown(m.sender, "autodl", COOLDOWN.DOWNLOADER);
  if (remaining > 0) return;
  await m.react("⏳");
  try {
    if (/tiktok\.com/i.test(url)) {
      const res = await ttsave(url);
      if (res.status !== 200) return m.reply(res.message || "Download failed");
      const d = res.data;
      if (d.type === "video") {
        await sock.sendMessage(m.chat, { video: { url: d.video.hd_play_url || d.video.play_url }, caption: d.title || "", mimetype: "video/mp4" }, { quoted: m });
        await sock.sendMessage(m.chat, { audio: { url: d.music.play_url }, mimetype: "audio/mpeg", ptt: false });
      } else if (d.type === "slide") {
        await sock.albumMessage(m.chat, d.images.map((i) => ({ image: { url: i } })), m);
        await sock.sendMessage(m.chat, { audio: { url: d.music.play_url }, mimetype: "audio/mpeg", ptt: false });
      }
      db.trackDownload(m.sender, m.pushName, "tiktok").catch(() => {});
      await m.react("✅");
    } else if (/instagram\.com/i.test(url)) {
      await m.react("⏳");
      let results = await instagram(url).catch(() => []);
      if (!results.length) results = await instaDL(url);
      if (!results.length) return m.reply("No media found");
      await sock.albumMessage(m.chat, results, m);
      db.trackDownload(m.sender, m.pushName, "instagram").catch(() => {});
      await m.react("✅");
    } else if (/(x|twitter)\.com/i.test(url)) {
      const results = await twitter(url);
      if (!results.length) return m.reply("No media found");
      await sock.albumMessage(m.chat, results, m);
      db.trackDownload(m.sender, m.pushName, "twitter").catch(() => {});
      await m.react("✅");
    }
  } catch (e) {
    m.reply(`Error: ${e.message}`);
  }
}

async function handleAntiDelete(sock, raw) {
  if (!raw?.message?.protocolMessage?.key) return;
  if (raw.key?.remoteJid?.endsWith("@g.us")) return;
  const p = raw.message.protocolMessage;
  if (p.type !== proto.Message.ProtocolMessage.Type.REVOKE) return;
  const key = p.key;
  if (!key?.id) return;
  const original = sock.store?.messages?.[key.id] || null;
  const jid = original?.key?.remoteJid || key.remoteJid || raw.key?.remoteJid;
  if (!jid) return;
  await sock.sendImageAsSticker(jid, "https://i.ibb.co.com/Z6vC7V5M/hapus.jpg", original || undefined);
  if (original?.message) await sock.copyNForward(jid, original, true);
}

async function handleAlbumMedia(sock, m) {
  const association = m.message?.messageContextInfo?.messageAssociation;
  if (association?.associationType !== 1 || !association.parentMessageKey?.id) return;
  if (!["imageMessage", "videoMessage"].includes(m.mtype)) return;

  const albumId = association.parentMessageKey.id;
  const album = sock.albumMedia.get(albumId) || [];
  const buffer = await sock.downloadMediaMessage(m);
  if (!buffer?.length) return;
  const entry = album.find((item) => item.message.key.id === m.key.id);
  if (entry) entry.buffer = buffer;
  else album.push({ message: m, buffer });
  sock.albumMedia.set(albumId, album);
  setTimeout(() => {
    if (sock.albumMedia.get(albumId) === album) sock.albumMedia.delete(albumId);
  }, 600000);

  return buffer;
}




module.exports = {
  register(sock) {
    sock.albumMedia = new Map();
    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const raw of messages) {
        if (FEATURES.AUTO_READ && !raw.key?.fromMe) await sock.readMessages([raw.key]);
        if (!raw.message) continue;
        if (!raw.key?.id) continue;
        if (raw.key.id.startsWith("INO")) continue;
        try {
          await handleAntiDelete(sock, raw);
        } catch (antiDeleteErr) {
          global.log?.warn(`Anti-delete error: ${antiDeleteErr.message}`);
        }
        const m = await serialize(sock, raw);
        if (m.isGroup && !m.fromMe && m.mtype !== "protocolMessage") {
          try { if (await db.isBungkam(m.chat, m.sender)) { await sock.sendMessage(m.chat, { delete: m.key }); continue; } } catch {}
        }
        db.trackUser(m.sender, m.pushName).catch(() => {});
        if (m.mtype === "albumMessage") continue;
        if (m.mtype === "imageMessage" || m.mtype === "videoMessage") {
          try {
            await handleAlbumMedia(sock, m);
          } catch (err) {
            global.log?.warn(`Album media download error: ${err.message}`);
          }
        }
        try {
          const { chat, sender, body } = m;
          if (!body) continue;
            if (!m.fromMe) continue;

            const isChatBanned = await db.isChatBanned(chat);
            const banCmd = body.slice(PREFIX.length).trim().split(/\s+/)[0].toLowerCase();
            const isBanBypass = ["banchat", "unbanchat", "ban", "unban"].includes(banCmd);
            if (isChatBanned && !isBanBypass) continue;
            try {
              const chatExists = await db.isChatAllowed(chat);
              if (!chatExists && sock.store?.chats?.[chat]) {
                const chatData = sock.store.chats[chat];
                await db.addAllowedChat(chat, chatData.name || "", chat.endsWith("@g.us") ? "group" : "individual");
              }
            } catch (e) { }
            const senderNumber = sender.split("@")[0];
            const isDev = m.fromMe;

            if (m.fromMe && (body === "/new" || body === "/close")) {
              await ai.handleControl(sock, m);
              continue;
            }

            if (m.fromMe && shell.hasPending(m.chat) && ai.sessions.has(m.chat)) {
              if (await ai.maybeReply(sock, m)) continue;
            }

            if (!m.fromMe && ai.sessions.has(m.chat)) {
              await ai.maybeReply(sock, m);
              continue;
            }

            if (body.startsWith("$") && !isDev) {
              global.log?.warn(`Blocked RCE attempt from ${senderNumber} (not in OWNER_NUMBER)`);
              continue;
            }

            if (isDev && (m.text.startsWith("=>") || m.text.startsWith("$"))) {
              if (m.text.startsWith("=>")) {
                try {
                  const code = m.text.slice(2);
                  let evaled = /await/i.test(code) ? await eval(`(async()=>{${code}})()`) : await eval(code);
                  if (typeof evaled !== "string") evaled = util.inspect(evaled);
                  m.reply(evaled);
                } catch (err) {
                  m.reply(String(err));
                }
              } else if (m.text.startsWith("$")) {
                m.reply("Executing...");
                exec(m.text.slice(2), async (err, stdout) => {
                  if (err) return m.reply(`${err}`);
                  if (stdout) return m.reply(stdout);
                });
              }
            }
            await handleAutoDownload(sock, m);
            if (!body.startsWith(PREFIX)) {
              continue;
            }
            const rawBody = body.slice(PREFIX.length).trim();
            const args = rawBody.split(/\s+/);
            const cmd = args.shift().toLowerCase();
            if (!global.commands.has(cmd)) {
              continue;
            }
            const mod = global.commands.get(cmd);
            const remaining = isOnCooldown(sender, cmd, mod.cooldown ?? DEFAULT_COOLDOWN);
            if (remaining > 0) {
              await m.reply(`「 ANTI-SPAM 」\n\n⏳ Wait ${(remaining / 1000).toFixed(1)}s before using *${cmd}* again.`);
              continue;
            }
            const text = `${cmd} ${args.join(" ")}`.trim();
            global.log?.cmd(text.length > 10 ? `${text.slice(0, 10)}...` : text);
            db.trackCommand(sender, m.pushName, cmd).catch(() => {});
            await mod.run(sock, m, args, m.reply, chat);
          } catch (err) {
            global.log?.error(`Handler error: ${err.message}`);
          }
        }
    });
  },
};
