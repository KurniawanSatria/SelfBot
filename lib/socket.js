const {
  default: makeWASocket,
  generateForwardMessageContent,
  generateWAMessageFromContent,
  generateWAMessage,
  downloadContentFromMessage,
  downloadMediaMessage,
  getContentType,
  getAudioWaveform,
} = require("baileys");
const pino = require("pino");
const {
  getRandom,
  getBuffer,
  convertToPtt,
  convertToMp3,
  bindWrapper,
  sendStickerPack,
} = require("./helper");
const { writeExifImg, writeExifVid } = require("./sticker");
const STICKER_PACKNAME = process.env.STICKER_PACKNAME || "Saturia";
const STICKER_AUTHOR = process.env.STICKER_AUTHOR || "Saturia";
const fs = require("fs");
const path = require("path");
const FileType = require("file-type");
const logger = pino({ level: "error" });
const storeModule = require("./store");
const crypto = require("crypto");
const makeInMemoryStore =
  storeModule.makeInMemoryStore || storeModule.default?.makeInMemoryStore;
const store = makeInMemoryStore({ logger: pino().child({ level: "error" }) });

exports.createSocket = (connectionOptions) => {
  const sock = makeWASocket(connectionOptions);
  if (!sock) {
    global.log?.error?.("makeWASocket returned undefined");
    return null;
  }
  bindWrapper(sock);
  sock.sendStickerPack = (jid, data, options) =>
    sendStickerPack(sock, jid, data, options);
  sock.downloadMediaMessage = async (m) => {
    let msg = m.msg || m;
    if (m.quoted && (m.quoted.msg || m.quoted).mimetype) {
      msg = m.quoted.msg || m.quoted;
    }
    let mime = msg.mimetype || "";
    let messageType = msg.mtype
      ? msg.mtype.replace(/Message/gi, "")
      : mime.split("/")[0];
    const stream = await downloadContentFromMessage(msg, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
  };

  sock.downloadAndSaveMediaMessage = async (
    message,
    filename,
    attachExtension = true
  ) => {
    const quoted = message.msg ? message.msg : message;
    const mime = (message.msg || message).mimetype || "";
    const messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0];
    const stream = await downloadContentFromMessage(quoted, messageType);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const type = await FileType.fileTypeFromBuffer(buffer);
    const trueFileName = attachExtension && type ? `${filename}.${type.ext}` : filename;
    fs.writeFileSync(trueFileName, buffer);
    return trueFileName;
  };

  sock.copyNForward = async (
    jid,
    message,
    forceForward = false,
    options = {},
  ) => {
    message.message =
      message.message?.ephemeralMessage?.message ||
      message.message ||
      undefined;
    let mtype = Object.keys(message.message)[0];
    if (message.message[mtype]?.viewOnce)
      delete message.message[mtype].viewOnce;
    let content = await generateForwardMessageContent(message, forceForward);
    let ctype = Object.keys(content)[0];
    let context =
      mtype !== "conversation" ? message.message[mtype].contextInfo : {};
    content[ctype].contextInfo = { ...context, ...content[ctype].contextInfo };
    const waMessage = await generateWAMessageFromContent(
      jid,
      content,
      options
        ? {
          ...content[ctype],
          ...options,
          ...(options.contextInfo
            ? {
              contextInfo: {
                ...content[ctype].contextInfo,
                ...options.contextInfo,
              },
            }
            : {}),
        }
        : {},
    );
    await sock.relayMessage(jid, waMessage.message, {
      messageId: waMessage.key.id,
    });
    return waMessage;
  };

  sock.sendImageAsSticker = async (jid, filePath, quoted, options = {}) => {
    let buff = Buffer.isBuffer(filePath)
      ? filePath
      : /^data:.*?\/.*?;base64,/i.test(filePath)
        ? Buffer.from(filePath.split`,`[1], "base64")
        : /^https?:\/\//.test(filePath)
          ? await getBuffer(filePath)
          : fs.existsSync(filePath)
            ? fs.readFileSync(filePath)
            : Buffer.alloc(0);
    let buffer = await writeExifImg(buff, {
      packname: STICKER_PACKNAME,
      author: STICKER_AUTHOR,
    });
    try {
      return await sock.sendMessage(
        jid,
        { sticker: { url: buffer }, ...options },
        { quoted },
      );
    } finally {
      if (typeof buffer === "string" && buffer) fs.unlink(buffer, () => {});
    }
  };

  sock.sendVideoAsSticker = async (jid, filePath, quoted, options = {}) => {
    let buff = Buffer.isBuffer(filePath)
      ? filePath
      : /^data:.*?\/.*?;base64,/i.test(filePath)
        ? Buffer.from(filePath.split`,`[1], "base64")
        : /^https?:\/\//.test(filePath)
          ? await getBuffer(filePath)
          : fs.existsSync(filePath)
            ? fs.readFileSync(filePath)
            : Buffer.alloc(0);
    let buffer = await writeExifVid(buff, {
      packname: STICKER_PACKNAME,
      author: STICKER_AUTHOR,
    });
    try {
      return await sock.sendMessage(
        jid,
        { sticker: { url: buffer }, ...options },
        { quoted },
      );
    } finally {
      if (typeof buffer === "string" && buffer) fs.unlink(buffer, () => {});
    }
  };

  sock.sendAudio = async (jid, buffer, options = {}) => {
    const { ptt = false, ...msgOptions } = options;
    let buff = Buffer.isBuffer(buffer)
      ? buffer
      : /^data:.*?\/.*?;base64,/i.test(buffer)
        ? Buffer.from(buffer.split`,`[1], "base64")
        : /^https?:\/\//.test(buffer)
          ? await getBuffer(buffer)
          : fs.existsSync(buffer)
            ? fs.readFileSync(buffer)
            : Buffer.alloc(0);
    const inputPath = getRandom(".tmp");
    fs.writeFileSync(inputPath, buff);

    let filePath, mimetype;

    try {
      if (ptt) {
        filePath = await convertToPtt(inputPath);
        mimetype = "audio/ogg; codecs=opus";
      } else {
        filePath = await convertToMp3(inputPath);
        mimetype = "audio/mpeg";
      }
    } finally {
      fs.existsSync(inputPath) && fs.unlinkSync(inputPath);
    }

    const outBuffer = fs.readFileSync(filePath);
    try {
      const waveform = await getAudioWaveform(outBuffer, logger);
      return await sock.sendMessage(
        jid,
        {
          audio: outBuffer,
          mimetype,
          ptt,
          ...(ptt ? { waveform } : {}),
        },
        msgOptions,
      );
    } finally {
      try { fs.unlinkSync(filePath); } catch {}
    }
  };
  sock.sendAudioV2 = async (jid, buffer) => {
    const inputPath = getRandom(".tmp");
    fs.writeFileSync(inputPath, buffer);
    let filePath, mimetype;
    try {
      filePath = await convertToPtt(inputPath);
      mimetype = "audio/ogg";
    } finally {
      fs.existsSync(inputPath) && fs.unlinkSync(inputPath);
    }

    const outBuffer = fs.readFileSync(filePath);
    try {
      return await sock.sendMessage(jid, { audio: outBuffer, mimetype, ptt: true });
    } finally {
      try { fs.unlinkSync(filePath); } catch {}
    }
  };

  sock.albumMessage = async (jid, array, quoted) => {
    const album = generateWAMessageFromContent(
      jid,
      {
        messageContextInfo: { messageSecret: crypto.randomBytes(32) },
        albumMessage: {
          expectedImageCount: array.filter((a) => a.hasOwnProperty("image"))
            .length,
          expectedVideoCount: array.filter((a) => a.hasOwnProperty("video"))
            .length,
        },
      },
      { userJid: sock.user.jid, quoted, upload: sock.waUploadToServer },
    );
    await sock.relayMessage(jid, album.message, { messageId: album.key.id });
    for (const content of array) {
      const img = await generateWAMessage(jid, content, {
        upload: sock.waUploadToServer,
      });
      img.message.messageContextInfo = {
        messageSecret: crypto.randomBytes(32),
        messageAssociation: { associationType: 1, parentMessageKey: album.key },
        dataSharingContext: { showMmDisclosure: true },
      };
      img.message.disappearingMode = {
        initiator: 3,
        trigger: 4,
        initiatorDeviceJid: jid,
        initiatedByExternalService: true,
        initiatedByUserDevice: true,
        initiatedBySystem: true,
        initiatedByServer: true,
        initiatedByAdmin: true,
        initiatedByUser: true,
        initiatedByApp: true,
        initiatedByBot: true,
        initiatedByMe: true,
      };
      await sock.relayMessage(jid, img.message, {
        messageId: img.key.id,
        quoted: {
          key: {
            remoteJid: album.key.remoteJid,
            id: album.key.id,
            fromMe: true,
            participant: sock.user.jid,
          },
          message: album.message,
        },
      });
    }

    return album;
  };

  return sock;
};

exports.createChildSocket = async (parentSocket, botInstance) => {
  const childSocket = makeWASocket({
    ...parentSocket.options,
    auth: parentSocket.auth,
    logger: parentSocket.logger,
    store: parentSocket.store,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    generateHighQualityLinkPreview: true,
  });
  bindWrapper(childSocket);
  childSocket.sendStickerPack = (jid, data, options) =>
    sendStickerPack(childSocket, jid, data, options);

  childSocket.downloadMediaMessage = parentSocket.downloadMediaMessage;
  childSocket.downloadAndSaveMediaMessage =
    parentSocket.downloadAndSaveMediaMessage;
  childSocket.copyNForward = parentSocket.copyNForward;
  childSocket.sendImageAsSticker = parentSocket.sendImageAsSticker;
  childSocket.sendVideoAsSticker = parentSocket.sendVideoAsSticker;
  childSocket.sendAudio = parentSocket.sendAudio;
  childSocket.sendAudioV2 = parentSocket.sendAudioV2;

  const eventsDir = path.join(__dirname, "..", "events");
  const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    try {
      const mod = require(path.join(eventsDir, file));

      if (typeof mod.register !== "function") {
        continue;
      }

      mod.register(childSocket, {
        saveCreds: parentSocket.options.auth.saveCreds,
        restartFn: async () => { },
      });
    } catch (err) { }
  }

  return childSocket;
};
