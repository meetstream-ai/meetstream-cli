# MeetStream CLI

**The MeetStream meeting-bot API from your terminal.** Create bots that join Zoom, Google Meet, and Microsoft Teams meetings; record, transcribe, and interact — without writing a line of code.

```bash
npm install -g @meetstream/cli     # or: npx @meetstream/cli ...
meetstream auth set-key ms_XXXX    # key from https://app.meetstream.ai/api-keys
meetstream bot create "https://meet.google.com/abc-defg-hij" -t deepgram
```

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

## Commands

| Command | What it does |
|---------|--------------|
| `auth set-key <key>` / `auth status` | Store + validate your API key (`MEETSTREAM_API_KEY` env wins) |
| `bot create <link>` | Send/schedule a bot — transcription provider, callbacks, live streams, MIA agent, per-participant streams, idempotency |
| `bot list` / `status --watch` / `detail` | Inspect bots |
| `bot summary <id>` | MeetStream's built-in AI meeting summary |
| `bot audio/video/streams/audio-streams <id>` | Presigned media URLs (incl. per-participant) |
| `bot participants/chats/screenshots/timeline <id>` | Meeting data |
| `bot send-message <id> <msg>` / `send-image <id> <url>` | Interact with a live meeting |
| `bot remove <id>` / `bot delete <id> --yes` | Leave meeting / permanently delete data |
| `transcript <bot_id> [--wait] [--json] [--raw]` | Fetch transcript — resolves `transcript_id` for you |
| `transcriptions <bot_id>` / `transcribe <bot_id> -p assemblyai` | List runs / re-transcribe with another provider |
| `calendar connect/events/schedule/auto-join on` | Google Calendar auto-join |
| `mia list/create/delete` | Conversational AI agents (MIA) |
| `listen [--forward url]` | Local webhook receiver with pretty, colorized lifecycle output |

Every command supports `--json` for scripting.

## The webhook model (what `listen` shows you)

Events arrive under the **`event`** key with `bot_id`, `bot_status`, `message`, `status_code` (200/500), `custom_attributes`:

```
bot.joining → bot.in_waiting_room → bot.inmeeting → bot.recording → bot.leaving → bot.stopped
→ manifest.completed → audio.processed → transcription.processed → video.processed → bot.done
```

`bot.stopped` fires **once** — `bot_status` says why (`Stopped` · `NotAllowed` lobby-timeout · `Denied` host-denied · `Error`). Streaming-only transcription providers end at `audio.processed` (no `bot.done`). `transcript_id` is **not** in webhooks — `meetstream transcript <bot_id>` resolves it via `/detail`.

## Configuration

| Source | Notes |
|--------|-------|
| `MEETSTREAM_API_KEY` | wins over the config file |
| `~/.meetstream/config.json` | written by `auth set-key` (0600) |
| `MEETSTREAM_API_URL` | override the base URL (default `https://api.meetstream.ai/api/v1`) |

## Development

```bash
npm install
npm test          # node --test, fully mocked (no network)
```

---

Docs: [docs.meetstream.ai](https://docs.meetstream.ai) · OpenAPI: [openapi.json](https://docs.meetstream.ai/openapi.json) · MCP server for agents: [meetstream-ai/meetstream-mcp](https://github.com/meetstream-ai/meetstream-mcp)

MIT © MeetStream.ai
