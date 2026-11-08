const cooldowns = new Map();

function isOnCooldown(key, id, cooldownMs) {
  const mapKey = `${key}:${id}`;
  const last = cooldowns.get(mapKey) ?? 0;
  const remaining = cooldownMs - (Date.now() - last);
  if (remaining > 0) return remaining;
  cooldowns.set(mapKey, Date.now());
  return 0;
}

let sweepTimer = null;
function startSweep(intervalMs = 600_000, maxAgeMs = 60_000) {
  if (sweepTimer) return sweepTimer;
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, ts] of cooldowns) {
      if (ts < cutoff) cooldowns.delete(key);
    }
  }, intervalMs);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  return sweepTimer;
}

startSweep();

module.exports = { isOnCooldown, cooldowns, startSweep };
