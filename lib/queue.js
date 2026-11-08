class Queue {
  constructor() {
    this.queues = new Map();
  }

  add(key, reply, fn) {
    if (typeof key === "function") {
      fn = key;
      reply = null;
      key = "default";
    } else if (typeof reply === "function" && typeof fn !== "function") {
      fn = reply;
      reply = null;
    }
    if (!this.queues.has(key)) this.queues.set(key, { tasks: [], running: false });
    const q = this.queues.get(key);
    const position = q.tasks.length + (q.running ? 1 : 0);
    if (position > 0 && typeof reply === "function") {
      reply(`⏳ You’re currently in queue at position ${position}.`);
    }
    q.tasks.push(fn);
    this.process(key);
  }

  async process(key) {
    const q = this.queues.get(key);
    if (!q || q.running) return;
    q.running = true;
    while (q.tasks.length > 0) {
      const task = q.tasks.shift();
      try {
        await task();
      } catch (err) {
        console.error(`[QUEUE ERROR: ${key}]`, err);
      }
    }
    q.running = false;
  }

  size(key = "default") {
    const q = this.queues.get(key);
    return q ? q.tasks.length + (q.running ? 1 : 0) : 0;
  }
}

module.exports = new Queue();
