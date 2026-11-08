const crypto = require("crypto");
const { Button } = require("../lib/helper");

function genPW(length = 8) {
	if (length < 4) throw new Error("Password must be at least 4 characters");
	const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	const numbers = "0123456789";
	const symbols = "!@#$%^&*";
	const random = (chars) => chars[crypto.randomInt(chars.length)];
	const password = [random(numbers), random(symbols), ...Array.from({ length: length - 2 }, () => random(letters))];
	for (let i = password.length - 1; i > 0; i--) {
		const j = crypto.randomInt(i + 1);
		[password[i], password[j]] = [password[j], password[i]];
	}
	return password.join("");
}

module.exports = {
	name: "genpw",
	aliases: ["pw"],
	description: "Generate a random password",
	category: "Tools",
	cooldown: 5000,
	async run(sock, m, args, reply) {
		const length = parseInt(args[0]) || 8;
		const password = genPW(length);
		new Button(sock).setBody(`「 GENERATED PASSWORD 」\n\`${password}\``).addCopy("Copy Password", password).send(m.chat);
	},
};
