# MeetStream CLI

**The MeetStream meeting-bot API from your terminal.** Create bots that join Zoom, Google Meet, and Microsoft Teams meetings; record, transcribe, and interact - without writing a line of code.

```bash
npm install -g @meetstream/cli     # or: npx @meetstream/cli ...
meetstream auth set-key ms_XXXX    # key from https://app.meetstream.ai/api-keys
meetstream bot create "https://meet.google.com/abc-defg-hij" -t deepgram
```

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
| `bot summary <id>` | MeetStream's built-in AI meeting summary |
| `bot audio <id>` / `bot video <id>` | Presigned recording URL (audio valid 1h, video valid 10min) |
| `bot streams <id>` / `bot audio-streams <id>` | Per-participant video/audio streams (needs `--separate-video`/`--separate-audio` at creation) |
| `bot participants <id>` | Everyone detected in the meeting |
| `bot chats <id>` | In-meeting chat messages |
| `bot screenshots <id>` | Screenshots captured during the meeting |
| `bot timeline <id>` | Speaker timeline - who spoke when |
| `bot send-message <id> <text...>` | Posts a chat message into the **live** meeting |
| `bot send-image <id> <img-url> [-d seconds]` | Shows an image/GIF as the bot's video frame (public URL required) |
| `bot remove <id>` | Makes the bot leave the meeting now (data is kept) |
| `bot delete <id> --yes` | **Permanently** deletes audio/video/transcripts - the `--yes` flag is mandatory, no accidental deletes |

<a name="bot-create-options"></a>
**`bot create` options:**
```
-n, --name <name>                bot display name (default "MeetStream Bot")
--video                           record video (default: audio only)
-t, --transcript <provider>      deepgram | assemblyai | sarvam | meetstream |
                                   jigsawstack | meeting_captions |
                                   deepgram_streaming | assemblyai_streaming
-l, --language <lang>            transcription language (provider-specific format)
-c, --callback <url>             HTTPS webhook for lifecycle events
--join-at <iso8601>              schedule a future join, e.g. 2026-07-02T15:00:00Z
--bot-message <msg>              chat message posted when the bot joins
--image-url <url>                PUBLIC image URL for the bot avatar
--retention-hours <n>            data retention window (API default 24h)
--separate-audio                 capture per-participant audio streams
--separate-video                 capture per-participant video streams
--zoom-obf                       use Zoom On-Behalf-Of
--agent-config-id <id>           attach a MIA conversational agent
--live-transcript-webhook <url>  webhook URL for live transcript chunks
--live-audio-ws <wss>            WebSocket URL for live audio out
--live-video-ws <wss>            WebSocket URL for live video out
--socket-ws <wss>                two-way bot-control WebSocket (socket_connection_url)
--attr <key=value...>            custom_attributes entries (echoed back in webhooks)
--idempotency-key <uuid>         safe-retry key - a retry returns the original
                                   bot (HTTP 507), never a duplicate
--everyone-left-timeout <sec>    leave after everyone else leaves (default 60)
--waiting-room-timeout <sec>     max seconds in waiting room (default 300)
--max-recording-seconds <sec>    max in-call recording seconds (default 14400)
```

### `transcript` / `transcriptions` / `transcribe` - transcription
| Command | What it does |
|---------|---------------|
| `transcript <bot-id> [--wait] [--raw] [--json]` | Fetches the transcript, resolving `transcript_id` automatically (it's never in webhooks). `--wait` polls until ready. Default output is readable `Speaker: text` lines. |
| `transcriptions <bot-id>` | Lists every transcription run for a bot - provider, status, presigned download URLs |
| `transcribe <bot-id> -p <provider>` | (Re-)transcribes a bot's recorded audio, optionally with a different provider or language |

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

### `mia` - conversational AI agents
| Command | What it does |
|---------|---------------|
| `mia list` | Lists agent configs |
| `mia create -f <config.json>` | Creates an agent config (`agent_name`, `mode`, `model`, `voice`, `transcriber`, …) - attach it to a bot with `--agent-config-id` |
| `mia delete <agent-config-id>` | Deletes an agent config |

### `listen` - local webhook receiver
| Command | What it does |
|---------|---------------|
| `listen [-p port] [--path path] [--forward url] [--json]` | Runs a local HTTP server that pretty-prints every MeetStream webhook event as it arrives, color-coded by outcome. Pair with `ngrok http <port>` to give `bot create --callback` a public URL during development. `--forward` also relays the raw payload to another URL. |

Every command supports `--json` for scripting.

---

## The webhook model - live-verified

Events arrive under the **`event`** key with `bot_id`, `bot_status`, `message`, `status_code` (200/500), `custom_attributes` - this is exactly what `meetstream listen` decodes and pretty-prints for you:

```
bot.joining → bot.in_waiting_room → bot.inmeeting → bot.recording → bot.leaving → bot.stopped
→ manifest.completed → audio.processed → transcription.processed → video.processed → bot.done
```

- **`bot.stopped` fires once** - `bot_status` says why (`Stopped` normal · `NotAllowed` lobby-timeout · `Denied` host-denied · `Error` crash).
- **Streaming-only transcription providers** (`deepgram_streaming`, `assemblyai_streaming`, `meeting_captions`) end at `audio.processed` - they never fire `transcription.processed`, `transcription.failed`, or `bot.done`.
- **`transcript_id` is not in webhooks** - `meetstream transcript <bot_id>` resolves it via `/detail` automatically.
- The public docs page for this describes a different (`bot_event`) envelope key - that's inaccurate; this CLI, and the [MeetStream MCP server](https://github.com/meetstream-ai/meetstream-mcp), both implement the live-verified model above.

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
| `transcript` returns "not ready yet" | The meeting isn't fully processed, or the provider is streaming-only (no post-call transcript) - check `bot status` first |
| `listen` events never arrive | Confirm the bot's `--callback` URL is a public HTTPS URL (use `ngrok http <port>`) - MeetStream will not retry non-2xx or unreachable webhooks |

## Development

```bash
npm install
npm test          # node --test, fully mocked (no network)
```

---

Docs: [docs.meetstream.ai](https://docs.meetstream.ai) · OpenAPI: [openapi.json](https://docs.meetstream.ai/openapi.json) · MCP server for AI agents: [@meetstream/mcp](https://github.com/meetstream-ai/meetstream-mcp) · Migrating from Recall.ai: [@meetstream/migrate](https://github.com/meetstream-ai/recall-meetstream-migration-kit)

MIT © MeetStream.ai

## Telemetry

The CLI sends **anonymous** usage events (which commands you run) to help us improve MeetStream. It never sends your API key, meeting URLs, transcripts, or any content. Disable it any time:

```bash
export MEETSTREAM_TELEMETRY=0   # or the standard DO_NOT_TRACK=1
```
