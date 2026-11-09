const { exec } = require("node:child_process");

const ALLOWED = new Set([
  "ls", "dir", "cat", "type", "pwd", "cd", "echo", "head", "tail", "wc", "find", "grep",
  "git", "node", "bun", "npm", "npx", "pnpm", "yarn",
  "python", "py", "pip",
  "ffmpeg", "ffprobe",
  "where", "which",
]);
const TIMEOUT = Number(process.env.SHELL_TIMEOUT_MS || 30000);
const MAX_OUTPUT = 3000;
const PENDING_TTL = 5 * 60 * 1000;

const blocked = /[;&|><`$]|\$\(|\.\.\//;

const pending = new Map();

function check(command) {
  const value = String(command || "").trim();
  if (!value) return { ok: false, reason: "Empty command." };
  if (blocked.test(value)) return { ok: false, reason: "Command contains chaining or redirect operators." };
  const bin = value.split(/\s+/)[0].toLowerCase();
  if (!ALLOWED.has(bin)) return { ok: false, reason: `Command '${bin}' is not in the allowlist.` };
  return { ok: true };
}

function run(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: TIMEOUT, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const out = [stdout, stderr].filter(Boolean).join("\n").trim();
      const clipped = out.length > MAX_OUTPUT ? `${out.slice(0, MAX_OUTPUT)}\n...[truncated]` : out;
      resolve({ ok: !err, output: clipped || (err ? err.message : "(no output)") });
    });
  });
}

function request(chat, command) {
  const result = check(command);
  if (!result.ok) return result;
  pending.set(chat, { command: command.trim(), at: Date.now() });
  return { ok: true, command: command.trim() };
}

function takePending(chat) {
  const entry = pending.get(chat);
  if (!entry) return null;
  pending.delete(chat);
  if (Date.now() - entry.at > PENDING_TTL) return null;
  return entry.command;
}

function clearPending(chat) {
  return pending.delete(chat);
}

function hasPending(chat) {
  return pending.has(chat);
}

setInterval(() => {
  const cutoff = Date.now() - PENDING_TTL;
  for (const [chat, entry] of pending) {
    if (entry.at < cutoff) pending.delete(chat);
  }
}, 60_000).unref?.();

module.exports = { check, run, request, takePending, clearPending, hasPending, ALLOWED };
