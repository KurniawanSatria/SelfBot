const { OWNER_NUMBERS } = require("./config");

function senderNumber(m) {
  return String(m?.sender || "").split("@")[0].split(":")[0] || "";
}

function isOwner(m) {
  if (!m) return false;
  if (m.fromMe) return true;
  return OWNER_NUMBERS.includes(senderNumber(m));
}

const isRceAllowed = isOwner;

module.exports = { isOwner, isRceAllowed, senderNumber };
