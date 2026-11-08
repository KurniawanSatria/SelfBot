const axios = require("axios");
const fs = require("fs");
const path = require("path");

const METADATA_URL = "https://raw.githubusercontent.com/xsalazar/emoji-kitchen-backend/main/app/metadata.json";
const CACHE_PATH = path.join(__dirname, "../assets/emojikitchen-metadata.json");
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

let metadataCache = null;

async function loadMetadata() {
    if (metadataCache) return metadataCache;
    if (fs.existsSync(CACHE_PATH)) {
        const stat = fs.statSync(CACHE_PATH);
        if (Date.now() - stat.mtimeMs < CACHE_TTL) {
            metadataCache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
            return metadataCache;
        }
    }
    const { data } = await axios.get(METADATA_URL, { timeout: 60000 });
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data));
    metadataCache = data;
    return data;
}

function toCodepoint(emoji) {
    return [...emoji].map(c => c.codePointAt(0).toString(16)).join("-");
}

function findCombo(metadata, cp1, cp2) {
    const combos = metadata.data?.[cp1]?.combinations?.[cp2];
    if (!combos?.length) return null;
    return combos.find(c => c.isLatest) || combos[0];
}

async function Emojimix(emoji1, emoji2) {
    const metadata = await loadMetadata();
    const cp1 = toCodepoint(emoji1);
    const cp2 = toCodepoint(emoji2);
    const combo = findCombo(metadata, cp1, cp2) || findCombo(metadata, cp2, cp1);
    return combo?.gStaticUrl || null;
}

module.exports = { Emojimix };
