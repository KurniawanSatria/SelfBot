const fs = require("fs");
const path = require("path");

class InMemoryStore {
  constructor({ logger, maxMessages = 5000, maxMessagesPerJid = 500 } = {}) {
    this.logger = logger;
    this.maxMessages = maxMessages;
    this.maxMessagesPerJid = maxMessagesPerJid;
    this.chats = {};
    this.contacts = {};
    this.messages = {};
    this.messagesByJid = {};
    this.messageOrder = [];
    this._head = 0;
    this._total = 0;
    this._counts = {};
  }

  addMessage(m) {
    const id = m?.key?.id;
    const jid = m?.key?.remoteJid;
    if (!id || !jid) return;
    if (this.messages[id]) { this.messages[id] = m; return; }
    this.messages[id] = m;
    (this.messagesByJid[jid] ||= {})[id] = m;
    this.messageOrder.push(id);
    this._total++;
    this._counts[jid] = (this._counts[jid] || 0) + 1;
    this._evictIfNeeded();
  }

  _drop(id) {
    const m = this.messages[id];
    if (!m) return;
    const jid = m.key?.remoteJid;
    delete this.messages[id];
    if (jid && this.messagesByJid[jid]) delete this.messagesByJid[jid][id];
    this._total = Math.max(0, this._total - 1);
    if (jid) this._counts[jid] = Math.max(0, (this._counts[jid] || 1) - 1);
  }

  removeMessage(id) {
    this._drop(id);
  }

  _evictIfNeeded() {
    const order = this.messageOrder;
    while (this._head < order.length) {
      const id = order[this._head];
      const m = this.messages[id];
      if (!m) { this._head++; continue; }
      const jid = m.key.remoteJid;
      if (this._total > this.maxMessages || (this._counts[jid] || 0) > this.maxMessagesPerJid) {
        this._drop(id);
        this._head++;
      } else break;
    }
    if (this._head > 1000) {
      this.messageOrder = order.slice(this._head);
      this._head = 0;
    }
  }

  loadMessage(jid, id) {
    if (id === undefined) { id = jid; jid = null; }
    if (!id) return null;
    if (this.messages[id]) return this.messages[id];
    if (jid && this.messagesByJid[jid]?.[id]) return this.messagesByJid[jid][id];
    return null;
  }

  bind(ev) {
    if (!ev) return;
    ev.on("messages.upsert", ({ messages }) => {
      for (const m of messages || []) this.addMessage(m);
    });
    ev.on("messages.update", (updates) => {
      for (const u of updates || []) {
        const id = u?.key?.id;
        if (!id) continue;
        if (u.update?.message === null || u.update?.status === 6) this._drop(id);
        else if (this.messages[id] && u.update?.message) this.messages[id].message = u.update.message;
      }
    });
    ev.on("messages.delete", ({ keys }) => {
      for (const k of keys || []) this._drop(k?.id);
    });
    ev.on("chats.upsert", (chats) => this._merge("chats", chats));
    ev.on("chats.update", (chats) => this._merge("chats", chats));
    ev.on("chats.delete", (ids) => {
      for (const id of ids || []) delete this.chats[id];
    });
    ev.on("contacts.upsert", (contacts) => this._merge("contacts", contacts));
    ev.on("contacts.update", (contacts) => this._merge("contacts", contacts));
  }

  _merge(field, list) {
    for (const item of list || []) {
      if (!item?.id) continue;
      this[field][item.id] = { ...(this[field][item.id] || {}), ...item };
    }
  }

  readFromFile(file) {
    try {
      if (!fs.existsSync(file)) return;
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (data.messages && typeof data.messages === "object") {
        for (const m of Object.values(data.messages)) this.addMessage(m);
      }
      if (data.chats && typeof data.chats === "object") Object.assign(this.chats, data.chats);
      if (data.contacts && typeof data.contacts === "object") Object.assign(this.contacts, data.contacts);
    } catch (e) {
      this.logger?.error?.(`store readFromFile failed: ${e.message}`);
    }
  }

  writeToFile(file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const snapshot = { messages: this.messages, chats: this.chats, contacts: this.contacts };
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot));
      fs.renameSync(tmp, file);
    } catch (e) {
      this.logger?.error?.(`store writeToFile failed: ${e.message}`);
    }
  }
}

function makeInMemoryStore(options = {}) {
  return new InMemoryStore(options);
}

module.exports = { InMemoryStore, makeInMemoryStore };
