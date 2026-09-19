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
--retention-hours <n>            data retention window in hours (API default 720, i.e. 30 days)
--separate-audio                 capture per-participant audio streams
--separate-video                 capture per-participant video streams
--zoom-zak-url <url>             Zoom: HTTPS endpoint returning a ZAK token (signed-in join)
--zoom-obf-url <url>             Zoom: HTTPS endpoint returning an OBF token (on-behalf-of join)
--google-login-domain <domain>   Google Meet: join signed in with an account from this
                                   registered Workspace domain (see `logins google`)
--teams-login-domain <domain>    Teams: join signed in with an account from this
                                   registered Microsoft 365 domain (see `logins teams`)
--sign-in-email <email>          signed-in bots: pin one registered account
                                   (requires a login domain flag)
--no-strict-email                with --sign-in-email: fall back to any free account
                                   in the domain instead of failing (API default: strict)
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
| `transcript` returns "not ready yet" | The meeting isn't fully processed, or the provider is streaming-only (no post-call transcript) - check `bot status` first |
| `bot create` with a login domain fails with 400 "not registered" | Register the domain first: `meetstream logins teams add-domain <domain>` (or `logins google add-domain`) |
| Signed-in Teams bot fails with 409 / 429 | The pinned account is busy or deactivated, or every account is in use. Add accounts (`logins teams add`), rotate a password (`set-password`), or use `--no-strict-email` |
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
