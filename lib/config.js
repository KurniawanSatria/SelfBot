require("dotenv").config();

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim().replace(/[^0-9]/g, ""))
    .filter(Boolean);
}

const PREFIX = process.env.PREFIX || ".";
const BOT_NUMBER = (process.env.BOT_NUMBER || "").replace(/[^0-9]/g, "");
const OWNER_NUMBERS = [
  ...splitList(process.env.OWNER_NUMBER),
  ...splitList(process.env.AUTHORIZED_NUMBERS),
].filter((v, i, a) => a.indexOf(v) === i);

const FEATURES = {
  AUTO_DOWNLOAD: process.env.AUTO_DOWNLOAD === "true",
  AUTO_READ: process.env.AUTO_READ === "true",
  ALWAYS_ONLINE: process.env.ALWAYS_ONLINE === "true",
  TYPING_INDICATOR: process.env.TYPING_INDICATOR === "true",
  ANTI_DELETE: process.env.ANTI_DELETE === "true",
  AUTO_REJECT_CALL: process.env.AUTO_REJECT_CALL === "true",
};

const CALL_WHITELIST = splitList(process.env.CALL_WHITELIST);

const AUTH_DIR = process.env.AUTH_DIR || "./session";
const TMP_DIR = process.env.TMP_DIR || "./tmp";
const STICKER_PACKNAME = process.env.STICKER_PACKNAME || "Saturia";
const STICKER_AUTHOR = process.env.STICKER_AUTHOR || "Saturia";
const FOOTER = "© Saturiaaa.";

const COOLDOWN = {
  DEFAULT: 1000,
  DOWNLOADER: 2000,
  AI: 500,
  STICKER: 300,
};

module.exports = {
  PREFIX,
  BOT_NUMBER,
  OWNER_NUMBERS,
  OWNER_NUMBER: OWNER_NUMBERS,
  FEATURES,
  CALL_WHITELIST,
  AUTH_DIR,
  TMP_DIR,
  STICKER_PACKNAME,
  STICKER_AUTHOR,
  FOOTER,
  COOLDOWN,
  THEHIVE_API_KEY: process.env.THEHIVE_API_KEY || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || "",
};
