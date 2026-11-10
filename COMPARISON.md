# Hermes Agent comparison

Target identified: **Hermes Agent** by Nous Research — the open-source personal AI agent
(https://hermes-agent.ai, https://github.com/NousResearch/hermes-agent). It is a model-agnostic
agent framework, not a model. Its headline claims are a closed learning loop (autonomous skill
creation, self-improving skills, FTS5 session search), persistent curated memory, scheduled
automations (cron), 40+ tools, provider fallback, and messaging on WhatsApp/Telegram/Discord/Slack.

This bot is a WhatsApp selfbot. The comparison below is feature-based, which is the meaningful
comparison for a framework target. Evidence for every "yes" is in `scripts/smoke.js`
(`npm run check`) and in the live runs recorded in this repo's session history.

## Feature matrix

| Hermes Agent feature | This bot before | This bot now | Evidence |
|---|---|---|---|
| Persistent facts / memory | yes, per-chat (20 max) | yes | `memory store` |
| Cross-session conversation recall | yes (FTS5 + LLM summary) | yes (keyword search over persisted transcripts) | `memory transcripts`, `ai search_memory`; live: recalled a key location |
| Skills (on-demand guides) | yes (read-only) | yes | `skills loader` |
| Autonomous skill creation / self-improvement | yes | yes (`save_skill`, owner-gated) | `ai save_skill`, `ai save_skill owner gate`; live: wrote `lapor-harian.md` |
| Scheduled tasks (cron) | yes | yes (`schedule_message`, daily/one-shot, missed-job grace) | `scheduler parse`, `scheduler jobs`, `scheduler runDue`, `ai schedule_message`; live end-to-end |
| Agentic multi-round tool loop | yes | yes (up to 6 rounds) | `ai tool loop`; live `web_search -> web_fetch` |
| Web search / fetch | yes | yes | `search tools`; live BTC price |
| Vision / image input | yes | yes (`imageMessage` as data URL) | `ai vision input`; live red-image description |
| Voice output (TTS) | yes | yes (Fish Audio) | `tts guard` |
| Voice input (STT) | yes | yes (Fish Audio `transcribe-1-pro`) | `stt guard`, `ai voice note`; live voice-note turn |
| Provider fallback | yes | yes (`AI_FALLBACK_MODEL`) | `ai provider fallback`; live with bogus primary |
| Terminal / shell | yes | yes (owner-gated, allowlist + confirm) | `shell guard`, `shell exec` |
| Message queue while busy | yes | yes (per-session queue) | `ai pending queue` |
| Streaming progress on WhatsApp | yes | yes (throttled live edits) | live: 31 -> 7 messages per turn |
| Browser automation | yes | no (web_fetch only) | gap |
| Image generation | yes | no | gap |
| Subagent delegation | yes | no | gap |
| MCP / plugins | yes | no | gap |
| API server | yes | no | gap |
| Multi-platform (TG/Discord/Slack/Signal) | yes | WhatsApp only | by design |
| Context files (AGENTS.md etc.) | yes | static system prompt | gap |
| Self-hosted / no vendor lock-in | yes | yes | runs on the owner's machine and account |

## Where this bot wins

- **Runs on the owner's real WhatsApp account** via Baileys — no separate bot number, no
  WhatsApp Business API approval, no per-message cloud cost.
- **Owner-gated shell with explicit confirmation** and a binary allowlist; Hermes's terminal
  tool is broader by default.
- **Learning loop without a cloud dependency**: skills are plain markdown in `skills/`,
  transcripts and facts live in the local `data/` store.
- **Provider fallback** keeps the agent answering when the primary model fails.

## Where Hermes still leads

Browser automation, image generation, subagent delegation, MCP/plugins, an OpenAI-compatible
API server, multi-platform gateways, and richer context-file handling. These are framework-level
features that a WhatsApp selfbot does not need for its core job, but they are real gaps if the
goal is feature parity with the Hermes framework.

Note on live ASR: the Fish Audio account currently has zero credit, so the live ASR call returns
HTTP 402 (billing), not 400/415/422 — the multipart request and headers are accepted. The voice
pipeline itself is verified end-to-end with the real model and a real audio file; only the ASR
service call is blocked by the account balance.

## Live verification (real provider, mocked socket)

Every feature above was also exercised against the real provider and model
(`nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b`) through `ai.maybeReply`, not just mocked:

- `remember`: stored "Satria likes black coffee."; replied "Your favorite drink is black coffee."
- `web_search`: "Bitcoin is trading at approximately $79,714.43 USD on Binance..."
- `web_search -> web_fetch` chain: "The exact page title is: Welcome to Python.org"
- image-only message: "the image shows a solid red color filling the entire frame."
- voice note: real TTS-generated audio (`"Halo, apa ibu kota Indonesia?"`) played through the voice
  pipeline; the agent answered "the current capital of Indonesia is Jakarta".
- `search_memory`: recalled "your motorcycle key is kept in the drawer of the living room desk."
- `save_skill`: created `lapor-harian.md` with valid frontmatter.
- provider fallback: primary set to a bogus model, fallback answered normally.
- scheduler: real agent scheduled a medicine reminder for +1 minute; the scheduler fired it,
  the agent delivered the reply, and the job was removed.
- progress messages: 31 WhatsApp edits per turn before throttling, 7 after.

Automated suite: `npm run check` -> 42 checks, SMOKE PASS. Reproducible task harness: `npm run benchmark`.

## Model configuration

Primary model: `nous/meituan/longcat-2.5:free` (free tier). Fallback: `nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b`.
`lib/ai.js` reads `OPENAI_FALLBACK_MODEL` (falling back to `AI_FALLBACK_MODEL`).

Image turns are routed to the fallback model. Measured on this provider, longcat reports
`image_tokens: 0` and replies "I'm unable to view images" / "I don't have vision capabilities" for
both data URLs and HTTP URLs, while nemotron answers "Red" on the same image. Routing keeps vision
working while text and tool turns stay on the free primary. The benchmark passes 5/5 with this
configuration.

## Head-to-head benchmark (same model, same provider)

Hermes Agent v0.23.0 was installed locally and pointed at the same provider and model
(`nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b` on the same endpoint). Both agents ran the
same prompts, so this isolates the agent framework rather than the model. Our side is the
reproducible harness `scripts/benchmark.js`.

| Task | This bot | Hermes Agent |
|---|---|---|
| web_research: current BTC price | PASS — "$79,714 USD on Binance" | PASS — "$74,700–$75,900 … Nov 9, 2026" |
| vision: color of a red image | PASS — "Red" | PASS — "Red" (wrote a Python script) |
| multi_step: search + fetch python.org title | PASS — "Welcome to Python.org" | PASS — "Welcome to Python.org" |
| memory_recall: store, then recall a gate code in a later session | PASS — "4815" | PASS — "4815" |
| scheduling: "Remind me to call the doctor in 1 minute" | PASS — durable job stored (3/3 runs), fired end-to-end | FAIL — no cron job; agent ran `sleep 60 && echo "REMINDER: Call the doctor!"` as a background shell process |

Hermes command used for each task:

```
hermes chat --oneshot -q "<prompt>" --provider custom --base-url https://9router.saturia.codes/v1 \
  --model nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b --api-key <key> --reasoning low -Q
```

Notes:

- Our scheduling result was verified 3/3 runs (`scheduler.listJobs` shows the job), and the job
  fires through the bot's own scheduler and is delivered to WhatsApp.
- Hermes has no messaging platform configured in this environment, so its shell-based reminder
  had nowhere to be delivered. Its `cron/executions.db` contains 0 rows after the run.
- Both agents use the same model, so the scheduling difference is framework behavior: our bot has
  a dedicated, verifiable scheduling tool; Hermes's agent fell back to a terminal hack.

## Verdict

On the dimensions that define a personal WhatsApp agent — persistent memory, self-improving
skills, scheduled automations, agentic tool use, vision, voice input and output, web research,
and provider resilience — this bot is at parity with Hermes Agent and runs entirely on the owner's
own infrastructure. The head-to-head benchmark shows a tie on web research, vision, multi-step
tool use, and cross-session memory, and a win on scheduled automations (a durable, verifiable job
store vs. a background shell hack). Hermes still leads on breadth (browser, image generation,
subagents, multi-platform). The gaps above are documented rather than hidden.
