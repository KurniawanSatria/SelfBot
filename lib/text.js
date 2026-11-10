function stripEmoji(text) {
  return String(text || "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/:[a-z0-9_+-]+:/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

module.exports = { stripEmoji };
