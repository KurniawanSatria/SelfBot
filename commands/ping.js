const os = require("os");
const { exec } = require("child_process");
const util = require("util");
const { Button } = require("../lib/helper");

const execPromise = util.promisify(exec);

module.exports = {
	name: "ping",
	aliases: ["p", "test", "status", "info"],
	description: "Check bot latency and system status",
	category: "Tools",
	cooldown: 5000,
	async run(sock, m, args, reply, jid) {
		try {
			const start = Date.now();
			const uptime = process.uptime();
			const memoryUsage = process.memoryUsage();
			const cpuInfo = os.cpus();
			const totalMem = os.totalmem();
			const freeMem = os.freemem();
			const days = Math.floor(uptime / 86400);
			const hours = Math.floor((uptime % 86400) / 3600);
			const minutes = Math.floor((uptime % 3600) / 60);
			const uptimeFormatted = `${days}d ${hours}h ${minutes}m`;
			const usedMem = totalMem - freeMem;
			const memoryUsagePercent = ((usedMem / totalMem) * 100).toFixed(2);
			let cpuUsage = "N/A";
			try {
				const { stdout } = await execPromise(`ps -p ${process.pid} -o %cpu`);
				cpuUsage = stdout.split("\n")[1].trim() + "%";
			} catch (error) {
				cpuUsage = `${cpuInfo.length} cores @ ${(cpuInfo[0].speed / 1000).toFixed(1)}GHz`;
			}
			const latency = Date.now() - start;
			const statusMessage = `
╭───「 ＳＹＳＴＥＭ － ＳＴＡＴＵＳ 」
│
│  ᴄᴘᴜ       ${cpuUsage}
│  ʀᴀᴍ       ${(usedMem / 1024 / 1024 / 1024).toFixed(2)} ɢʙ / ${(totalMem / 1024 / 1024 / 1024).toFixed(2)} ɢʙ
│  ᴜꜱᴀɢᴇ     ${memoryUsagePercent}%
│  ɴᴏᴅᴇ      ${process.version}
│  ᴏꜱ        ${os.platform()} ${os.arch()}
│  ᴜᴘᴛɪᴍᴇ    ${uptimeFormatted}
│  ʟᴀᴛᴇɴᴄʏ   ${latency}ᴍs
│
╰────────────────────────

╭───「 ＢＯＴ － ＲＵＮＴＩＭＥ 」
│
│  ʜᴇᴀᴘ      ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} ᴍʙ
│  ᴛᴏᴛᴀʟ     ${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} ᴍʙ
│  ʀꜱꜱ       ${(memoryUsage.rss / 1024 / 1024).toFixed(2)} ᴍʙ
│  ᴛʜʀᴇᴀᴅꜱ   ${cpuInfo.length}
│
╰──────────────────────
`.trim();
			m.reply(statusMessage)
		} catch (error) {
			console.error("System status error:", error);
			await reply("╰─ System status check failed. Please try again.");
		}
	},
};
