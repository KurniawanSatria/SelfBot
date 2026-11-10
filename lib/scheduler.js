const moment = require("moment-timezone");
const db = require("./database");

const TZ = process.env.TZ || "Asia/Jakarta";
const MAX_JOBS = Number(process.env.AI_MAX_JOBS || 50);
const CHECK_MS = Number(process.env.AI_SCHEDULER_INTERVAL_MS || 30000);
const GRACE_MS = 10 * 60 * 1000;

function store() {
  const data = db.db?.data;
  if (!data) return null;
  if (!Array.isArray(data.aiJobs)) data.aiJobs = [];
  return data.aiJobs;
}

function parseWhen(value, now = moment().tz(TZ)) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}/.test(raw)) {
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? null : time;
  }
  const relative = raw.match(/^(?:(?:dalam|in)\s+(?:waktu\s+)?)?(\d+)\s*(menit|mnt|minute|minutes|jam|j|hour|hours|hari|day|days)\b/);
  if (relative) {
    const amount = parseInt(relative[1], 10);
    const unit = relative[2];
    const ms = unit.startsWith("menit") || unit === "mnt" || unit.startsWith("minute")
      ? 60000
      : unit === "jam" || unit === "j" || unit.startsWith("hour")
        ? 3600000
        : 86400000;
    return now.valueOf() + amount * ms;
  }
  const clock = raw.match(/(?:besok\s+)?jam\s+(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?/);
  if (clock) {
    let hour = parseInt(clock[1], 10);
    const minute = parseInt(clock[2] || "0", 10);
    if (clock[3] === "pm" && hour < 12) hour += 12;
    if (clock[3] === "am" && hour === 12) hour = 0;
    const target = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
    if (/besok/.test(raw) || target.valueOf() <= now.valueOf()) target.add(1, "day");
    return target.valueOf();
  }
  return null;
}

async function listJobs(chat = null) {
  await db.init();
  const jobs = store() || [];
  return chat ? jobs.filter((job) => job.chat === chat) : jobs;
}

async function addJob(chat, text, at, repeat = "once") {
  await db.init();
  const jobs = store();
  if (!jobs || jobs.length >= MAX_JOBS) return null;
  const job = {
    id: `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    chat,
    text: String(text || "").slice(0, 2000),
    at,
    repeat: repeat === "daily" ? "daily" : "once",
    createdAt: Date.now(),
  };
  jobs.push(job);
  await db.write();
  return job;
}

async function removeJob(id) {
  await db.init();
  const jobs = store();
  if (!jobs) return false;
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) return false;
  jobs.splice(index, 1);
  await db.write();
  return true;
}

async function rescheduleDaily(job) {
  await db.init();
  const found = (store() || []).find((item) => item.id === job.id);
  if (!found) return;
  found.at = job.at + 24 * 60 * 60 * 1000;
  await db.write();
}

async function runDue(sock, fire) {
  const jobs = await listJobs();
  const now = Date.now();
  for (const job of jobs) {
    if (job.at > now) continue;
    if (job.at < now - GRACE_MS) {
      await removeJob(job.id);
      continue;
    }
    if (job.repeat === "daily") await rescheduleDaily(job);
    else await removeJob(job.id);
    const ok = await fire(sock, job);
    if (ok === false) await addJob(job.chat, job.text, Date.now() + 60000, "once");
  }
}

function start(sock, fire) {
  const timer = setInterval(() => {
    runDue(sock, fire).catch((err) => global.log?.warn?.(`Scheduler error: ${err.message}`));
  }, CHECK_MS);
  if (timer.unref) timer.unref();
}

module.exports = { parseWhen, listJobs, addJob, removeJob, runDue, start, TZ };
