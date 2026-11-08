# dead code audit, 2026-11-08

## lib/removebg.js

- used by: nothing. no command requires it, no event uses it.
- dead code: the entire module. it also ships a hardcoded live3d public key and signing config for a third party service, and depends on `form-data`.
- risk: ships a third party key and a dead network path. pending owner decision, see open questions.

## lib/downloader.js

- used by: events/message.upsert.js imports `{ instagram, ttsave, instaDL, twitter }`.
- dead code: `pinterest()` is exported but never called. `spawn` from `child_process` is imported but never used. `cheerio` is imported but only used by `pinterest()`.
- risk: `cheerio` declared as a dependency in task 1.1 even though it is only needed by the dead `pinterest()` function. if `pinterest()` is deleted, `cheerio` can be removed from package.json.

## lib/database.js

- used by: events/message.upsert.js (isBungkam, isChatBanned, isChatAllowed, addAllowedChat, trackUser, trackCommand, trackDownload), commands/banchat.js and unbanchat.js (addBannedChat, isChatBanned), index.js (init, loadAllChatsFromStore, cleanupExpiredSessions, flush).
- dead code: `isBungkam` is called but the bungkam command was removed, so the table will always be empty. `addBannedChat` and `isChatBanned` are still used.
- risk: the bungkam check in message.upsert.js runs a db query on every group message for a feature that no longer exists. harmless but wasteful.

## lib/auth.js and lib/config.js

- used by: lib/auth.js uses config.js. commands and events were unified to use config.js in task 1.2.
- dead code: none after task 1.2. before that, backup.js, banchat.js, unbanchat.js, crm.js, menu.js, and message.upsert.js each had their own owner check logic.
- risk: low. the two owner sources (OWNER_NUMBER and AUTHORIZED_NUMBERS) are merged in config.js. verified OWNER_NUMBER in .env contains only the owner's number.

## commands/crm.js

- used by: owner only, gated by OWNER_NUMBERS.
- dead code: none. it is large (34k, 1500 lines) but functional.
- risk: the crmstore dependency is initialized in index.js. if crmstore fails to bind, the command returns "CRMStore is not active." which is acceptable.

## live test 2026-11-08

pending. task 4.1 and 4.2 not yet run.
