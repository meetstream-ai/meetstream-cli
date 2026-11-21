# MeetStream CLI

**The MeetStream meeting-bot API from your terminal.** Create bots that join Zoom, Google Meet, and Microsoft Teams meetings; record, transcribe, and interact - without writing a line of code.

```bash
npm install -g @meetstream/cli     # or: npx @meetstream/cli ...
meetstream auth set-key ms_XXXX    # key from https://app.meetstream.ai/api-keys
meetstream bot create "https://meet.google.com/abc-defg-hij" -t deepgram
```

---

## Three ways to integrate

| Flow | What it is | Price per meeting hour |
|---|---|---|
| **1. Recording only** (Bot API) | Send a bot to Zoom, Google Meet or Microsoft Teams, then get recordings, transcripts, participants, chat and webhooks after the call, or live data during the call. This is the default. | Bot price |
| **2. Agents in meetings, your own stack** (recommended first for an agent) | **2a. Bridge server:** the bot streams live audio to your server, and your server sends audio, chat and images back; you run your own speech-to-text, LLM and voice, hosted or local. **2b. Your own agent as the brain:** Claude Code, Codex, Hermes, OpenClaw and others answer through `model.provider: "local_agent"` and the Agent Kit. | 2a: bot price only. 2b: bot price + $0.25 agent infrastructure. No model tokens charged in either. |
| **3. Managed agent infrastructure** (Agents API) | MeetStream hosts the voice agent (API name: MIA). **3a.** MeetStream's inbuilt keys. Pipeline: OpenAI + Deepgram (Deepgram speech-to-text; OpenAI LLM and voice). Realtime: OpenAI only. Any other provider: bring your own key. **3b.** Your own provider keys. | Bot price + $0.25 agent infrastructure + the models you pick |

Bot price: $0.35 per recording hour ($0.25 at volume). The MeetStream transcription add-on is $0.10 per hour, waived with your own provider key. Guide: [Integration paths](https://docs.meetstream.ai/guides/introduction/integration-paths).

Want an agent but not sure which flow? Run your own stack (flow 2, any models, local ones included), or let MeetStream host it (flow 3, no infrastructure work).

**Flow 1, recording only.** Decide first: notes after the call (post-call), or something during the call (live)?

```bash
# Post-call: bot, webhooks, then the transcript
meetstream bot create "https://meet.google.com/abc-defg-hij" -t meetstream -c https://you.example.com/webhook
meetstream transcript <bot_id> --wait

# Live: live transcript webhook, then raise the bot's hand while it is in the meeting
meetstream bot create "https://zoom.us/j/123456789" -t deepgram_streaming --live-transcript-webhook https://you.example.com/live
meetstream bot raise-hand <bot_id>     # POST /api/v1/bots/{bot_id}/send_command {"command":"raise_hand"}
```

**Flow 2a, bridge server.** The bot opens two WebSockets to your server: live audio in (`--live-audio-ws`, sent as `live_audio_required`) and the meeting control socket (`--socket-ws`, sent as `socket_connection_url`) for the audio, chat, images and interrupts you send back. Your server runs its own speech-to-text, LLM and voice, hosted or local (for example Parakeet for local speech-to-text). Bot price only.

```bash
meetstream bot create "https://meet.google.com/abc-defg-hij" \
  --live-audio-ws wss://your-bridge.example.com/bridge/audio \
  --socket-ws wss://your-bridge.example.com/bridge
```

Starter: [MeetStream Bridge](https://github.com/meetstream-ai/meetstream-agent) (FastAPI, OpenAI Realtime by default; swap in your own or local models). Guides: [Bridge server architecture](https://docs.meetstream.ai/guides/websockets/bridge-server-architecture), [Real-time audio streaming](https://docs.meetstream.ai/guides/websockets/real-time-audio-streaming), [Meeting control patterns](https://docs.meetstream.ai/guides/websockets/meeting-control-patterns).

**Flow 2b, your own agent as the brain.** Run the [MeetStream Agent Kit](https://github.com/meetstream-ai/agent-kit) bridge, save an agent with `"model": {"provider": "local_agent", "local_agent": {"url": "https://..."}}` (`meetstream mia create -f`), check it with `meetstream mia check <id>`, then send a bot with `--agent-config <id>`. Bot price + $0.25 agent infrastructure; no model tokens charged for your agent's reasoning. Flow 2b is opt-in and needs the local agent feature on for your account. Meeting speech reaches an agent that has access to your computer and terminal (prompt injection), so keep the lowest access level (`readonly`) and the activation code on, and keep your computer, the agent and the bridge running for the whole call. Guide: [MIA screen sharing and custom agents](https://docs.meetstream.ai/guides/features/mia-screen-sharing-and-custom-agents).

**Flow 3, managed agent infrastructure.** Save an agent config, then send a bot with its id. Nothing else is needed on the bot.

```bash
cat > agent.json <<'JSON'
{
  "agent_name": "Meeting assistant",
  "mode": "pipeline",
  "transcriber": { "provider": "deepgram", "model": "nova-3", "key_source": "meetstream" },
  "model": { "provider": "openai", "model": "gpt-4.1", "key_source": "meetstream",
             "system_prompt": "You are a helpful meeting assistant. Keep answers short.",
             "first_message": "Hi, I'm an AI assistant on this call." },
  "voice": { "provider": "openai", "voice_id": "coral", "key_source": "meetstream" }
}
JSON
meetstream mia create -f agent.json                       # prints agent_config_id
meetstream bot create "https://meet.google.com/abc-defg-hij" --agent-config <agent_config_id>
```

- **3a. MeetStream's inbuilt keys:** `"key_source": "meetstream"` on each pipeline section, no `api_key`. Inbuilt keys per mode: Pipeline: OpenAI + Deepgram (Deepgram speech-to-text; OpenAI LLM and voice). Realtime: OpenAI only. Any other provider: bring your own key.
- **3b. Your own keys:** your provider keys (OpenAI, Anthropic, Deepgram, ElevenLabs and others) under Integrations; `"key_source": "user"` or leave it out. Your provider bills you for model usage.
- **Price:** bot price + $0.25 agent infrastructure + the per-hour price of each model you pick (the dashboard agent editor shows the rate before the bot runs). Details: [Voice agent pricing and keys](https://docs.meetstream.ai/guides/mia/pricing-and-keys) and the [MIA API guide](https://docs.meetstream.ai/guides/mia/mia-api-guide).

If inbuilt keys are not on for your account yet, `mia create` fails with `MeetStream-managed keys are not available for <section>. Use your own key.` Switch that section to your own key (3b) and run it again; do not loop.

A voice agent bot takes only `--agent-config`. Do not add `--socket-ws` or `--live-audio-ws` to it (the usual cause of a silent agent); flows 2a and 3 are separate bots.

---

## Authentication

Every command authenticates to `https://api.meetstream.ai/api/v1` with `Authorization: Token <your-key>`. There's no OAuth flow or separate CLI login - the API key **is** the credential.

| Source | Precedence | Set with |
|--------|------------|----------|
| `MEETSTREAM_API_KEY` env var | wins if set | `export MEETSTREAM_API_KEY=ms_XXXX` |
| `~/.meetstream/config.json` | fallback | `meetstream auth set-key <key>` (written with `0600` permissions) |

Verify it's working:
```bash
meetstream auth status
# ✓ API key is valid
#   key              ms_if0…tH0L
#   base_url         https://api.meetstream.ai/api/v1
#   bots_on_account  12
```
Get a key at [app.meetstream.ai/api-keys](https://app.meetstream.ai/api-keys).

---

## 60-second tour

```bash
# 1. Point a local webhook receiver at the world (great for dev)
meetstream listen --port 3333            # then: ngrok http 3333

# 2. Send a bot to a meeting with post-call transcription
meetstream bot create "https://zoom.us/j/123456789" \
  --name "Notetaker" -t deepgram -c https://<ngrok>.ngrok.io/webhook

# 3. Watch it join
meetstream bot status <bot_id> --watch

# 4. Grab the transcript the moment it's ready
meetstream transcript <bot_id> --wait
```

---

## Full capability list

### `auth` - credentials
| Command | What it does |
|---------|---------------|
| `auth set-key <key>` | Stores the key in `~/.meetstream/config.json` |
| `auth status` | Validates the configured key against the live API and shows account info |

### `bot` - lifecycle, media, interaction
| Command | What it does |
|---------|---------------|
| `bot create <meeting-link>` | Sends (or schedules with `--join-at`) a bot to the meeting. See [`bot create` options](#bot-create-options) below - transcription provider, callbacks, per-participant streams, MIA agent, live streaming, idempotency, and safe leave-timeout defaults. |
| `bot list` | Lists every bot on the account with id, status, and platform |
| `bot status <id> [--watch]` | Current status; `--watch` polls every 5s until a terminal state (`Stopped`/`Done`/`Error`/etc.) |
| `bot detail <id>` | Full session metadata - platform, timings, status timeline, `transcript_id`, `caption_file` |
| `bot summary <id>` | Removed: the API has no summary endpoint. The command exits 2 and points to `meetstream transcript <id>` |
| `bot audio <id>` / `bot video <id>` | Recording download link (valid 1 hour) |
| `bot streams <id>` / `bot audio-streams <id>` | Per-participant video/audio streams (needs `--separate-video`/`--separate-audio` at creation) |
| `bot participants <id>` | Everyone detected in the meeting |
| `bot chats <id>` | In-meeting chat messages |
| `bot screenshots <id>` | Screenshots captured during the meeting, newest first, each with a 1h download URL |
| `bot timeline <id> [--download]` | Speaker timeline - who spoke when. A very large timeline comes back as `speaker_timeline_url` (a download link valid 1h, no key needed) with `size_bytes`; `--download` fetches the file and prints the timeline |
| `bot send-message <id> <text...>` | Posts a chat message into the **live** meeting |
| `bot send-image <id> <img-url> [-d seconds]` | Shows an image/GIF as the bot's video frame (public URL required) |
| `bot raise-hand <id>` / `bot lower-hand <id>` | Raises or lowers the bot's hand with the meeting's own control (Google Meet, Zoom, Teams). The bot must be in the meeting (`409` otherwise). Prints `hand_raised`, the state read back from the meeting. Safe to repeat |
| `bot remove <id>` | Makes the bot leave the meeting now (data is kept) |
| `bot delete <id> --yes` | **Permanently** deletes audio/video/transcripts - the `--yes` flag is mandatory, no accidental deletes |

<a name="bot-create-options"></a>
**`bot create` options:**
```
-n, --name <name>                bot display name (default "MeetStream Bot")
--video                           record video as well as audio (default: audio only)
--video-layout <layout>           with --video: speaker_view (default) or grid_view;
                                   Google Meet and Teams also accept
                                   speaker_view_default, grid_view_default
-t, --transcript <provider>      deepgram | assemblyai | sarvam | meetstream |
                                   jigsawstack | smallest | meeting_captions |
                                   deepgram_streaming | assemblyai_streaming |
                                   smallest_streaming (smallest* need your Smallest AI
                                   key saved in the dashboard)
-l, --language <lang>            transcription language (provider-specific format)
-c, --callback <url>             HTTPS webhook for lifecycle events
--join-at <iso8601>              schedule a future join, e.g. 2026-07-02T15:00:00Z
--bot-message <msg>              chat message posted when the bot joins
--image-url <url>                PUBLIC image URL for the bot avatar
--retention-hours <n>            data retention window in hours (API default 720, i.e. 30 days)
--separate-audio                 capture per-participant audio streams
--separate-video                 capture per-participant video streams
--zoom-zak-url <url>             Zoom: HTTPS endpoint returning a ZAK token (signed-in join)
--zoom-obf-url <url>             Zoom: HTTPS endpoint returning an OBF token (on-behalf-of join)
--zoom-use-own-app               Zoom: send use_own_app=true (needs your connected Zoom app)
--storage-id <id>                save the recording to this storage destination of
                                   your workspace (default: the workspace default)
--google-login-domain <domain>   Google Meet: join signed in with an account from this
                                   registered Workspace domain (see `logins google`)
--teams-login-domain <domain>    Teams: join signed in with an account from this
                                   registered Microsoft 365 domain (see `logins teams`)
--sign-in-email <email>          signed-in bots: pin one registered account
                                   (requires a login domain flag)
--no-strict-email                with --sign-in-email: fall back to any free account
                                   in the domain instead of failing (API default: strict)
--agent-config <id>              attach a voice agent (Agents API); nothing else is
                                   needed (alias: --agent-config-id)
--agent-param <key=value...>     agent_config_params for {{variable}} placeholders
--live-transcript-webhook <url>  webhook URL for live transcript chunks
--live-audio-ws <wss>            WebSocket URL for live audio out
--live-video-ws <wss>            reserved: accepted by the API, but live video
                                   is not delivered yet
--socket-ws <wss>                two-way bot-control WebSocket (socket_connection_url)
--attr <key=value...>            custom_attributes entries (echoed back in webhooks)
--idempotency-key <uuid>         safe-retry key - a retry returns the original
                                   bot (HTTP 507), never a duplicate
--everyone-left-timeout <sec>    leave after everyone else leaves (default 60)
--waiting-room-timeout <sec>     max seconds in waiting room (default 300)
--max-recording-seconds <sec>    max in-call recording seconds (default 14400)
```

**Zoom joins through your Zoom app.** Bots join through your Zoom app (Meeting SDK) with an OBF token (`--zoom-obf-url`, on behalf of a user who is in the meeting) or a ZAK token (`--zoom-zak-url`, a signed-in bot), the way Zoom asks Meeting SDK apps to join since 2 March 2026. Setup: [Zoom Marketplace app setup](https://docs.meetstream.ai/guides/app-integrations/zoom-marketplace-app-setup) · [Zoom authenticated bots (ZAK and OBF)](https://docs.meetstream.ai/guides/app-integrations/zoom-authenticated-bots).

**Signed-in bots.** `--google-login-domain` / `--teams-login-domain` send the `google_meet` / `teams` block (`login_required: true` plus the domain, and `sign_in_email` / `strict_email` when you pin an account). Pass one domain flag, not both. The CLI warns on stderr (and still sends) if the meeting link host doesn't match the platform. Signed-in Teams bots show the Microsoft account's own name and picture, so `--name` / `--image-url` are not applied.

```bash
meetstream bot create "https://teams.microsoft.com/l/meetup-join/..." --teams-login-domain bots.example.com
meetstream bot create "https://meet.google.com/abc-defg-hij" --google-login-domain example.com \
  --sign-in-email notetaker@example.com --no-strict-email
```

### `logins` - accounts for signed-in bots
Register the domain once, then the accounts bots sign in as. Setup guides: [Teams](https://docs.meetstream.ai/guides/app-integrations/teams-signed-in-bots) · [Google](https://docs.meetstream.ai/guides/app-integrations/google-signed-in-bots).

| Command | What it does |
|---------|---------------|
| `logins teams domains` / `logins teams domain <domain>` | List domains / show one domain with its accounts |
| `logins teams add-domain <domain> [--name <n>]` | Register a Microsoft 365 bot tenant domain (`login_mode` is always `always`) |
| `logins teams update-domain <domain> --name <n>` | Rename a domain |
| `logins teams remove-domain <domain> [--yes]` | Delete a domain **and all its accounts** (asks to confirm unless `--yes`) |
| `logins teams list --domain <d>` / `logins teams get <login-id>` | List accounts in a domain / show one account (lease status, last session result) |
| `logins teams add --domain <d> --email <e> [--password-stdin]` | Register an account. Teams runs **one bot per account at a time**: register N accounts for N concurrent bots |
| `logins teams set-password <login-id> [--password-stdin]` | Rotate the password (also reactivates an account disabled after a failed sign-in) |
| `logins teams disable\|enable <login-id>` | Take an account out of / back into rotation |
| `logins teams remove <login-id> [--yes]` | Delete an account |
| `logins google domains` / `domain` / `add-domain` / `update-domain` / `remove-domain` | Same as Teams, for Google Workspace domains (`add-domain` and `update-domain` also take `--login-mode always\|if_required`) |
| `logins google list --domain <d>` | List accounts in a domain |
| `logins google add --domain <d> --email <e> --key key.pem --cert cert.pem` | Register an account with the SSO private key + certificate from the setup guide (Google accounts use SSO, not passwords) |
| `logins google set-cert <login-id> --domain <d> --key <pem> --cert <pem>` | Replace an account's SSO key + certificate |
| `logins google disable\|enable\|remove <login-id> --domain <d>` | Same as Teams; Google needs the account's domain |

**Passwords are never CLI arguments** (they would land in shell history). The CLI reads them from `--password-stdin`, else `MEETSTREAM_LOGIN_PASSWORD`, else a hidden prompt, and never prints them. The API treats them as write-only.
```bash
printf '%s' "$BOT_PASSWORD" | meetstream logins teams add --domain bots.example.com \
  --email bot1@bots.example.com --password-stdin
```

### `transcript` / `transcriptions` / `transcribe` - transcription
| Command | What it does |
|---------|---------------|
| `transcript <bot-id> [--wait] [--raw] [--json]` | Fetches the transcript, resolving `transcript_id` automatically (it's never in webhooks). `--wait` polls until ready. Default output is readable `Speaker: text` lines. A failed transcript (`422`) prints `Transcript failed: <reason>` and the next step, and exits with code 4: it will not become ready, so fix the cause and run `transcribe`. |
| `transcriptions <bot-id>` | Lists every transcription run for a bot - provider, status, download links |
| `transcribe <bot-id> -p <provider>` | (Re-)transcribes a bot's recorded audio, optionally with a different provider (`deepgram`, `assemblyai`, `sarvam`, `meetstream`, `jigsawstack`, `smallest`) or language |

### `calendar` - Google Calendar auto-join
| Command | What it does |
|---------|---------------|
| `calendar connect --client-id --client-secret --refresh-token` | Connects a Google Calendar via OAuth refresh-token flow |
| `calendar list` | Connected calendars |
| `calendar events` | Fetch/sync upcoming events |
| `calendar schedule <event-id>` / `calendar unschedule <event-id>` | Send/remove a bot for one specific event |
| `calendar auto-join on\|off [-n name] [--video]` | Enable/disable auto-join for **every** meeting on the calendar |
| `calendar reschedule <bot-id> <iso8601>` | Change a scheduled bot's join time |
| `calendar cancel <bot-id>` | Delete a scheduled (not-yet-joined) bot |

### `mia` (alias `agents`) - Agents API, voice agent configs
| Command | What it does |
|---------|---------------|
| `mia list` | Lists agent configs |
| `mia get <agent-config-id>` | Shows one agent config (secrets come back masked) |
| `mia create -f <config.json>` | Creates an agent config (`agent_name`, `mode`, `model`, `voice`, `transcriber`, `agent`, ...). Attach it with `bot create <link> --agent-config <id>` |
| `mia update <agent-config-id> -f <blocks.json>` | Updates a config (`PUT`): each block in the file replaces the saved block, so send whole blocks. Running bots are not changed |
| `mia delete <agent-config-id>` | Deletes an agent config |
| `mia check <agent-config-id>` | Tests the connection to your local agent bridge (`model.provider: "local_agent"`). Exits 3 when the status is not `ok` |

The config file takes the fields of the [MIA API guide](https://docs.meetstream.ai/guides/mia/mia-api-guide), including `key_source` on `transcriber` / `model` / `voice`, `transcriber.language`, and the agent options `agent.tools` (`["screen"]` on Google Meet), `agent.chat_input`, `agent.quiet_actions` and `agent.speak_only_when_asked`.

### `balance` - prepaid balance
| Command | What it does |
|---------|---------------|
| `balance [--json]` | Shows your prepaid balance (`GET /api/v1/billing/balance`, read only). Available when the balance endpoint is on for your account; until then it prints where to see the balance (https://app.meetstream.ai/billing) and exits 3 |

### `listen` - local webhook receiver
| Command | What it does |
|---------|---------------|
| `listen [-p port] [--path path] [--forward url] [--json]` | Runs a local HTTP server that pretty-prints every MeetStream webhook event as it arrives, color-coded by outcome. Pair with `ngrok http <port>` to give `bot create --callback` a public URL during development. `--forward` also relays the raw payload to another URL. |

Every command supports `--json` for scripting.

---

## The webhook model - live-verified

Every event carries **`event`**, `bot_id`, `message`, `status_code` (200/500), `custom_attributes` and `timestamp`, and most also carry **`bot_event`**. This is exactly what `meetstream listen` decodes and pretty-prints for you:

```
bot.joining → bot.in_waiting_room → bot.inmeeting → bot.recording → bot.leaving → bot.stopped
→ manifest.completed → audio.processed → transcription.processed → video.processed → bot.done
```

- **Terminals are two-layer.** Every ending arrives once as `event: "bot.stopped"`, and `bot_event` says why: `bot.stopped` (normal), `bot.kicked` (removed by a participant), `bot.notallowed` (lobby timeout), `bot.denied` (host refused), `bot.failed` (crash). Not admitted, denied and failed carry `status_code: 500`. Branch on `bot_event`: a kick and a clean exit both report `bot_status: "Stopped"`.
- **Streaming-only transcription providers** (`deepgram_streaming`, `assemblyai_streaming`, `meeting_captions`) never fire `transcription.processed` or `transcription.failed`. `bot.done` still fires, on every path.
- **`transcript_id` is not in webhooks** - `meetstream transcript <bot_id>` resolves it via `/detail` automatically.
- The [MeetStream MCP server](https://github.com/meetstream-ai/meetstream-mcp)'s `webhook_events_guide` tool describes the same model.

---

## Configuration

| Source | Notes |
|--------|-------|
| `MEETSTREAM_API_KEY` | wins over the config file |
| `~/.meetstream/config.json` | written by `auth set-key` (`0600`) |
| `MEETSTREAM_API_URL` | override the base URL (default `https://api.meetstream.ai/api/v1`) |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "No API key found" | Run `meetstream auth set-key <key>` or `export MEETSTREAM_API_KEY=...` |
| `auth status` fails with 401 | Key is invalid/revoked - generate a new one at [app.meetstream.ai/api-keys](https://app.meetstream.ai/api-keys) |
| `transcript` prints "Transcript failed: ..." (exit 4) | The transcript ended `Failed` (API `422`), for example the provider rejected the key or its usage limit was reached. Fix the cause, then `meetstream transcribe <bot-id>` |
| `mia create` fails with "MeetStream-managed keys are not available" | Inbuilt keys are not on for your account yet. Use your own provider key for that section (`"key_source": "user"`) |
| `transcript` returns "not ready yet" | The meeting isn't fully processed, or the provider is streaming-only (no post-call transcript) - check `bot status` first |
| `bot create` with a login domain fails with 400 "not registered" | Register the domain first: `meetstream logins teams add-domain <domain>` (or `logins google add-domain`) |
| Signed-in Teams bot fails with 409 / 429 | The pinned account is busy or deactivated, or every account is in use. Add accounts (`logins teams add`), rotate a password (`set-password`), or use `--no-strict-email` |
| `HTTP 429 ... (retry after N s)` on `bot create` | Prepaid accounts can create only a few bots per minute and per hour. Wait N seconds, then run the command again with the same `--idempotency-key`. With `--json`, the error has `retry_after` |
| `listen` events never arrive | Confirm the bot's `--callback` URL is a public HTTPS URL (use `ngrok http <port>`) - MeetStream will not retry non-2xx or unreachable webhooks |

## Development

```bash
npm install
npm test          # node --test, fully mocked (no network)
```

---

## Latest docs

- [Integration paths](https://docs.meetstream.ai/guides/introduction/integration-paths) · [CLI](https://docs.meetstream.ai/build-with-ai/meetstream-cli)
- [Bridge server architecture](https://docs.meetstream.ai/guides/websockets/bridge-server-architecture) · [MIA screen sharing and custom agents](https://docs.meetstream.ai/guides/features/mia-screen-sharing-and-custom-agents)
- [Create Bot payload reference](https://docs.meetstream.ai/api-reference/create-bot-payload-reference) · [Webhooks and events](https://docs.meetstream.ai/guides/webhooks/webhooks-and-events) · [Errors](https://docs.meetstream.ai/errors)
- [MIA API guide](https://docs.meetstream.ai/guides/mia/mia-api-guide) · [Voice agent pricing and keys](https://docs.meetstream.ai/guides/mia/pricing-and-keys)

For the latest details, fetch the page with `.md` appended, read https://docs.meetstream.ai/llms.txt, or connect the docs MCP server at https://docs.meetstream.ai/_mcp/server. If this README and the docs differ, the docs are correct.

OpenAPI: [openapi.json](https://docs.meetstream.ai/openapi.json) · Hosted MCP server for AI agents: `https://mcp.meetstream.ai/mcp` ([docs](https://docs.meetstream.ai/build-with-ai/meetstream-mcp-server)) · Migrating from Recall.ai: [@meetstream/migrate](https://www.npmjs.com/package/@meetstream/migrate) · Changes: [CHANGELOG.md](CHANGELOG.md)

MIT © MeetStream.ai

## Telemetry

The CLI sends **anonymous** usage events (which commands you run) to help us improve MeetStream. It never sends your API key, meeting URLs, transcripts, or any content. Disable it any time:

```bash
export MEETSTREAM_TELEMETRY=0   # or the standard DO_NOT_TRACK=1
```
