const { DisconnectReason } = require("baileys");
const { Boom } = require("@hapi/boom");
const NUMBER = process.env.BOT_NUMBER;
const { sleep } = require("../lib/helper");
const chalk = require("chalk");
const moment = require("moment-timezone");

module.exports = {
  register(sock, { saveCreds, restartFn }) {
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on(
      "connection.update",
      async ({ connection, lastDisconnect, qr }) => {
        if (qr && !sock.authState?.creds?.registered) {
          try {
            await sleep(3000);
            const time = () =>
              chalk.dim(`[${moment.tz("Asia/Jakarta").format("HH:MM")}]`);
            const phoneNumber = NUMBER.replace(/[^0-9]/g, "");
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(
              `\n${time()} ${chalk.cyan.bold("📲 PAIRING CODE:")} ${chalk.yellow.bold(code)}\n`,
            );
          } catch (err) {
            global.log?.warn(
              `Pairing code request failed: ${err?.message || err}`,
            );
          }
        }

        if (connection === "connecting") {
          global.log?.info("Connecting to WhatsApp...");
        }

        if (connection === "open") {
          global.startTime = Date.now();
          global.log?.success("Connected to WhatsApp!");
        }

        if (connection === "close") {
          const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
          if (code !== DisconnectReason.loggedOut) {
            global.log?.warn(`Disconnected (code ${code}), reconnecting...`);
            restartFn();
          } else {
            global.log?.error("Logged out.");
          }
        }
      },
    );
  },
};
