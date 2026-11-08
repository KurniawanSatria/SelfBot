 
const fs = require("fs")
const path = require("path")
const Database = require("better-sqlite3")
const { proto, generateWAMessage, generateWAMessageFromContent, generateMessageIDV2 } = require("baileys")

const dbPath = require("path").join(__dirname, "..", "data", "crmdb.db")

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('busy_timeout = 5000')

db.exec(`
	CREATE TABLE IF NOT EXISTS messages (
		rowid INTEGER PRIMARY KEY AUTOINCREMENT,
		id TEXT NOT NULL,
		chat TEXT NOT NULL,
		sender TEXT,
		timestamp INTEGER,
		data BLOB NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_messages_chat
	ON messages(chat);

	CREATE INDEX IF NOT EXISTS idx_messages_sender
	ON messages(sender);

	CREATE INDEX IF NOT EXISTS idx_messages_timestamp
	ON messages(timestamp);

	CREATE TABLE IF NOT EXISTS nodes (
		id TEXT NOT NULL,
		chat TEXT NOT NULL,
		data TEXT NOT NULL,
		created_at INTEGER DEFAULT (strftime('%s','now')),
		PRIMARY KEY(id, chat)
	);

	CREATE INDEX IF NOT EXISTS idx_nodes_chat
	ON nodes(chat);

	CREATE INDEX IF NOT EXISTS idx_nodes_id
	ON nodes(id);
`)

function serializeNode(value) {
	return JSON.stringify(value, (_, value) => {
		if (Buffer.isBuffer(value)) {
			return {
				type: 'Buffer',
				data: value.toString('base64')
			}
		}

		if (value instanceof Uint8Array) {
			return {
				type: 'Buffer',
				data: Buffer.from(value).toString('base64')
			}
		}

		return value
	})
}

function deserializeNode(value) {
	if (!value) return null

	return JSON.parse(value, (_, value) => {
		if (value && value.type === 'Buffer') {
			if (typeof value.data === 'string') {
				return Buffer.from(value.data, 'base64')
			}

			if (Array.isArray(value.data)) {
				return Buffer.from(value.data)
			}
		}

		return value
	})
}

const insertMessage = db.prepare(`
	INSERT INTO messages (
		id,
		chat,
		sender,
		timestamp,
		data
	) VALUES (?, ?, ?, ?, ?)
`)

const getMessage = db.prepare(`
	SELECT data
	FROM messages
	WHERE id = ?
	AND chat = ?
	ORDER BY rowid DESC
	LIMIT 1
`)

const getMessageById = db.prepare(`
	SELECT data
	FROM messages
	WHERE id = ?
	ORDER BY rowid DESC
	LIMIT 1
`)

const hasMessageStmt = db.prepare(`
	SELECT 1
	FROM messages
	WHERE id = ?
	AND chat = ?
	LIMIT 1
`)

const hasMessageByIdStmt = db.prepare(`
	SELECT 1
	FROM messages
	WHERE id = ?
	LIMIT 1
`)

const deleteMessageStmt = db.prepare(`
	DELETE FROM messages
	WHERE id = ?
	AND chat = ?
`)

const deleteMessageByIdStmt = db.prepare(`
	DELETE FROM messages
	WHERE id = ?
`)

const getMessageChatsStmt = db.prepare(`
	SELECT DISTINCT chat
	FROM messages
	WHERE id = ?
`)

const getMessagesStmt = db.prepare(`
	SELECT rowid, id, chat, sender, timestamp, data
	FROM messages
	WHERE chat = ?
	ORDER BY rowid DESC
	LIMIT ?
`)

const getAllMessagesStmt = db.prepare(`
	SELECT rowid, id, chat, sender, timestamp, data
	FROM messages
	ORDER BY rowid DESC
	LIMIT ?
`)

const countMessagesStmt = db.prepare(`
	SELECT COUNT(*) AS count
	FROM messages
`)

const insertNodeStmt = db.prepare(`
	INSERT INTO nodes (
		id,
		chat,
		data
	) VALUES (?, ?, ?)
	ON CONFLICT(id, chat)
	DO UPDATE SET
		data = excluded.data,
		created_at = strftime('%s','now')
`)

const getNodeStmt = db.prepare(`
	SELECT data
	FROM nodes
	WHERE id = ?
	AND chat = ?
	ORDER BY created_at DESC
	LIMIT 1
`)

const getNodeByIdStmt = db.prepare(`
	SELECT data
	FROM nodes
	WHERE id = ?
	ORDER BY created_at DESC
	LIMIT 1
`)

const deleteNodeStmt = db.prepare(`
	DELETE FROM nodes
	WHERE id = ?
	AND chat = ?
`)

const deleteNodeByIdStmt = db.prepare(`
	DELETE FROM nodes
	WHERE id = ?
`)

const getNodeChatsStmt = db.prepare(`
	SELECT DISTINCT chat
	FROM nodes
	WHERE id = ?
`)

const cleanupOrphanNodesStmt = db.prepare(`
	DELETE FROM nodes
	WHERE NOT EXISTS (
		SELECT 1
		FROM messages
		WHERE messages.id = nodes.id
		AND messages.chat = nodes.chat
	)
`)

function saveMessage(message, chat) {
	if (!message || !chat) return false

	try {
		const id = message?.key?.id

		if (!id) return false

		const encoded = proto.WebMessageInfo.encode(message).finish()

		insertMessage.run(
			id,
			chat,
			message.participant ||
				message.key?.participant ||
				null,
			Number(
				message.messageTimestamp ||
				Math.floor(Date.now() / 1000)
			),
			Buffer.from(encoded)
		)

		return true
	} catch {
		return false
	}
}

function loadMessage(id, chat) {
	if (!id) return null

	try {
		const row = chat
			? getMessage.get(id, chat)
			: getMessageById.get(id)

		if (!row?.data) return null

		return proto.WebMessageInfo.decode(row.data)
	} catch {
		return null
	}
}

function loadMessageById(id) {
	if (!id) return null

	try {
		const row = getMessageById.get(id)

		if (!row?.data) return null

		return proto.WebMessageInfo.decode(row.data)
	} catch {
		return null
	}
}

function saveNode(id, chat, node) {
	if (!id || !chat || !node) return false

	try {
		insertNodeStmt.run(
			String(id),
			String(chat),
			serializeNode(node)
		)

		return true
	} catch {
		return false
	}
}

function loadNode(messageId, jid) {
	if (!messageId) return null

	try {
		let row = null

		if (jid) {
			row = getNodeStmt.get(
				String(messageId),
				String(jid)
			)
		}

		if (!row?.data) {
			row = getNodeByIdStmt.get(
				String(messageId)
			)
		}

		if (!row?.data) return null

		return deserializeNode(row.data)
	} catch {
		return null
	}
}

function saveAdditionalNode(id, chat, content, attrs = {}) {
	if (!id || !chat) return false

	try {
		const existing = getNodeStmt.get(
			String(id),
			String(chat)
		)

		if (existing?.data) {
			const node = deserializeNode(existing.data)

			if (node && typeof node === 'object') {
				node.content = content
				node.attrs = { ...node.attrs, ...attrs }

				insertNodeStmt.run(
					String(id),
					String(chat),
					serializeNode(node)
				)

				return true
			}
		}

		insertNodeStmt.run(
			String(id),
			String(chat),
			serializeNode({
				tag: 'message',
				attrs: {
					id: String(id),
					from: String(chat),
					t: String(Math.floor(Date.now() / 1000)),
					type: 'text',
					...attrs
				},
				content
			})
		)

		return true
	} catch {
		return false
	}
}

function loadAdditionalNode(id, chat) {
	const node = loadNode(id, chat)

	if (!node) return null

	return node.content ?? null
}

function hasMessage(id, chat) {
	if (!id) return false

	try {
		if (chat) {
			return !!hasMessageStmt.get(
				String(id),
				String(chat)
			)
		}

		return !!hasMessageByIdStmt.get(
			String(id)
		)
	} catch {
		return false
	}
}

function deleteMessage(id, chat) {
	if (!id) return false

	try {
		if (chat) {
			deleteMessageStmt.run(
				String(id),
				String(chat)
			)

			deleteNodeStmt.run(
				String(id),
				String(chat)
			)

			return true
		}

		deleteMessageByIdStmt.run(
			String(id)
		)

		deleteNodeByIdStmt.run(
			String(id)
		)

		return true
	} catch {
		return false
	}
}

function getMessages(chat, limit = 100) {
	if (!chat) return []

	try {
		return getMessagesStmt
			.all(
				String(chat),
				Math.max(1, Number(limit) || 100)
			)
			.map(row => {
				let data = null

				try {
					data = proto.WebMessageInfo.decode(
						row.data
					)
				} catch {}

				return {
					rowid: row.rowid,
					id: row.id,
					chat: row.chat,
					sender: row.sender,
					timestamp: row.timestamp,
					data
				}
			})
	} catch {
		return []
	}
}

function getAllMessages(limit = 100) {
	try {
		return getAllMessagesStmt
			.all(
				Math.max(1, Number(limit) || 100)
			)
			.map(row => {
				let data = null

				try {
					data = proto.WebMessageInfo.decode(
						row.data
					)
				} catch {}

				return {
					rowid: row.rowid,
					id: row.id,
					chat: row.chat,
					sender: row.sender,
					timestamp: row.timestamp,
					data
				}
			})
	} catch {
		return []
	}
}

function countMessages() {
	try {
		return Number(
			countMessagesStmt.get()?.count || 0
		)
	} catch {
		return 0
	}
}

function cleanup() {
	try {
		const cutoff =
			Math.floor(Date.now() / 1000) -
			7 * 24 * 60 * 60

		db.transaction(() => {
			db.prepare(`
				DELETE FROM messages
				WHERE timestamp IS NOT NULL
				AND timestamp < ?
			`).run(cutoff)

			if (global.MESSAGE_CACHE_LIMIT) {
				const limit = Number(
					global.MESSAGE_CACHE_LIMIT
				)

				if (limit > 0) {
					db.prepare(`
						DELETE FROM messages
						WHERE rowid NOT IN (
							SELECT rowid
							FROM messages
							ORDER BY rowid DESC
							LIMIT ?
						)
					`).run(limit)
				}
			}

			cleanupOrphanNodesStmt.run()
		})()
	} catch {}
}

function getStats() {
	try {
		const messages = db.prepare(`
			SELECT
				COUNT(*) AS count,
				COALESCE(SUM(LENGTH(data)), 0) AS size,
				COALESCE(AVG(LENGTH(data)), 0) AS avg
			FROM messages
		`).get()

		const nodes = db.prepare(`
			SELECT
				COUNT(*) AS count,
				COALESCE(SUM(LENGTH(data)), 0) AS size,
				COALESCE(AVG(LENGTH(data)), 0) AS avg
			FROM nodes
		`).get()

		const dbSize = fs.existsSync(dbPath)
			? fs.statSync(dbPath).size
			: 0

		const walSize = fs.existsSync(`${dbPath}-wal`)
			? fs.statSync(`${dbPath}-wal`).size
			: 0

		const shmSize = fs.existsSync(`${dbPath}-shm`)
			? fs.statSync(`${dbPath}-shm`).size
			: 0

		const totalFileSize =
			dbSize +
			walSize +
			shmSize

		const totalMessages =
			Number(messages?.count || 0)

		const limit =
			Number(global.MESSAGE_CACHE_LIMIT || 0)

		const formatBytes = bytes => {
			if (!bytes) return '0 B'

			const units = [
				'B',
				'KB',
				'MB',
				'GB',
				'TB'
			]

			let value = Number(bytes)
			let index = 0

			while (
				value >= 1024 &&
				index < units.length - 1
			) {
				value /= 1024
				index++
			}

			return `${value.toFixed(2)} ${units[index]}`
		}

		return {
			cache: {
				messages: totalMessages,
				limit,
				remaining: limit
					? Math.max(
						0,
						limit - totalMessages
					)
					: 0,
				usagePercent: limit
					? (
						totalMessages /
						limit *
						100
					).toFixed(2) + '%'
					: '∞'
			},
			payload: {
				messages: {
					count: Number(
						messages?.count || 0
					),
					size: Number(
						messages?.size || 0
					),
					sizeHuman: formatBytes(
						messages?.size || 0
					),
					avgSize: Math.round(
						messages?.avg || 0
					),
					avgSizeHuman: formatBytes(
						messages?.avg || 0
					)
				},
				nodes: {
					count: Number(
						nodes?.count || 0
					),
					size: Number(
						nodes?.size || 0
					),
					sizeHuman: formatBytes(
						nodes?.size || 0
					),
					avgSize: Math.round(
						nodes?.avg || 0
					),
					avgSizeHuman: formatBytes(
						nodes?.avg || 0
					)
				}
			},
			files: {
				db: {
					size: dbSize,
					human: formatBytes(dbSize)
				},
				wal: {
					size: walSize,
					human: formatBytes(walSize)
				},
				shm: {
					size: shmSize,
					human: formatBytes(shmSize)
				},
				total: {
					size: totalFileSize,
					human: formatBytes(
						totalFileSize
					)
				}
			},
			ratio: {
				dbPerMessage: totalMessages
					? formatBytes(
						messages.size /
						totalMessages
					)
					: '0 B',
				nodePerMessage: nodes?.count
					? formatBytes(
						nodes.size /
						nodes.count
					)
					: '0 B'
			}
		}
	} catch {
		return {
			cache: {
				messages: 0,
				limit: Number(
					global.MESSAGE_CACHE_LIMIT || 0
				),
				remaining: 0,
				usagePercent: '0%'
			},
			payload: {
				messages: {
					count: 0,
					size: 0,
					sizeHuman: '0 B',
					avgSize: 0,
					avgSizeHuman: '0 B'
				},
				nodes: {
					count: 0,
					size: 0,
					sizeHuman: '0 B',
					avgSize: 0,
					avgSizeHuman: '0 B'
				}
			},
			files: {
				db: {
					size: 0,
					human: '0 B'
				},
				wal: {
					size: 0,
					human: '0 B'
				},
				shm: {
					size: 0,
					human: '0 B'
				},
				total: {
					size: 0,
					human: '0 B'
				}
			},
			ratio: {
				dbPerMessage: '0 B',
				nodePerMessage: '0 B'
			}
		}
	}
}

function loadFullMessage(id, chat) {
	const node = loadNode(id, chat)

	return {
		message: loadMessage(id, chat),
		additionalNode: node?.content ?? null
	}
}

function persist(message, id, jid, options) {
	queueMicrotask(() => {
		try {
			saveMessage(proto.WebMessageInfo.fromObject(message), jid)

			saveAdditionalNode(id, jid, options.additionalNodes || [], {
				t: String(Math.floor(Date.now() / 1000)),
				...options.additionalAttributes
			})
		} catch {}
	})
}

if (!global.__crmStoreBoundConns) {
	global.__crmStoreBoundConns = new WeakSet()
}

function bind(conn) {
	if (!conn) return conn
	if (global.__crmStoreBoundConns.has(conn)) return conn

	global.__crmStoreBoundConns.add(conn)

	conn.ev.on('messages.upsert', ({ messages }) => {
		try {
			for (const message of messages || []) {
				if (!message?.key?.id) continue

				const chat = message.key.remoteJid

				if (!chat) continue

				saveMessage(message, chat)
			}
		} catch {}
	})

	conn.ws?.on?.('CB:message', node => {
		try {
			const id = node?.attrs?.id

			if (!id) return

			const chat =
				node?.attrs?.from ||
				node?.attrs?.recipient ||
				node?.attrs?.participant

			if (!chat) return

			saveNode(
				id,
				chat,
				node
			)
		} catch {}
	})

	if (typeof conn.sendMessage === 'function' && !conn.sendMessage.__crmStorePatched) {
		const originalSendMessage = conn.sendMessage.bind(conn)

		const patchedSendMessage = async (jid, content, options = {}) => {
			const messageId = options.messageId || generateMessageIDV2()

			const generated = await generateWAMessage(jid, content, {
				...options,
				messageId,
				userJid: conn.user?.id,
				upload: conn.waUploadToServer
			})

			const sent = await originalSendMessage(jid, content, { ...options, messageId })

			persist(generated.message, messageId, jid, options)

			return sent
		}

		patchedSendMessage.__crmStorePatched = true
		conn.sendMessage = patchedSendMessage
	}

	if (typeof conn.relayMessage === 'function' && !conn.relayMessage.__crmStorePatched) {
		const originalRelayMessage = conn.relayMessage.bind(conn)

		const patchedRelayMessage = async (jid, content, options = {}) => {
			const messageId = options.messageId || generateMessageIDV2()

			const generated = generateWAMessageFromContent(jid, content, {
				...options,
				messageId,
				userJid: conn.user?.id,
				upload: conn.waUploadToServer
			})

			const resultPromise = originalRelayMessage(jid, content, { ...options, messageId })

			persist(generated, messageId, jid, options)

			return resultPromise
		}

		patchedRelayMessage.__crmStorePatched = true
		conn.relayMessage = patchedRelayMessage
	}

	return conn
}

if (!global.__crmStoreCleanupTimer) {
	let lastCleanup = 0

	global.__crmStoreCleanupTimer = setInterval(() => {
		const now = Date.now()

		if (
			now - lastCleanup <
			60 * 60 * 1000
		) {
			return
		}

		lastCleanup = now

		cleanup()

		try {
			db.pragma(
				'wal_checkpoint(PASSIVE)'
			)
		} catch {}
	}, 60 * 1000)
}

module.exports = {
	db,
	bind,
	saveMessage,
	loadMessage,
	loadMessageById,
	saveNode,
	loadNode,
	saveAdditionalNode,
	loadAdditionalNode,
	hasMessage,
	deleteMessage,
	getMessages,
	getAllMessages,
	countMessages,
	cleanup,
	getStats,
	loadFullMessage
}