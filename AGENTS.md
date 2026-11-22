# AGENTS.md

Guidance for AI coding agents working in this repository. This repo **is** the MeetStream CLI (`@meetstream/cli`).

## Always use the MeetStream MCP

When building anything against the MeetStream API, install and use the MeetStream MCP. It is the current source of truth for endpoints, request and response fields, webhook events, provider names and bot behaviour.

Do not treat the files in this repository as authoritative for MeetStream API behaviour. They can lag the API. If local code and the MCP disagree, the MCP wins unless the user says otherwise.

Server name: `meetstream`. URL: `https://mcp.meetstream.ai/mcp`. MeetStream hosts it; there is no local install. Do not install the `@meetstream/mcp` npm package: the hosted URL is the supported server.

Add the URL with **no key** and sign in: the client opens app.meetstream.ai, the user clicks Allow, and the dashboard creates an API key for that connection (delete it on the API keys page to disconnect). Use an API key header only when the client cannot do OAuth.

### Claude Code

```sh
claude mcp add --transport http meetstream https://mcp.meetstream.ai/mcp
# then /mcp -> Authenticate
```

With a key instead: add `--header "Authorization: Bearer $MEETSTREAM_API_KEY"`.

The [MeetStream Claude plugin](https://github.com/meetstream-ai/claude-plugin) is a separate, complementary install. It ships **skills only** and does not include the MCP server, so install both:

```sh
/plugin marketplace add meetstream-ai/claude-plugin
```

### Claude (desktop and web)

Customize -> Connectors -> + -> Add custom connector. Name it `meetstream`, set the URL to `https://mcp.meetstream.ai/mcp`, leave the OAuth fields blank and click Connect, then sign in and click Allow. If OAuth is not an option, `https://mcp.meetstream.ai/mcp?key=YOUR_MEETSTREAM_API_KEY` works, since Claude's custom connectors cannot send a custom auth header; give each person their own key so it can be revoked individually.

### Cursor

Add to `~/.cursor/mcp.json`, or install the [MeetStream Cursor plugin](https://github.com/meetstream-ai/meetstream-cursor-plugin), then click Connect in Cursor Settings -> MCP:

```json
{
  "mcpServers": {
    "meetstream": { "url": "https://mcp.meetstream.ai/mcp" }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`; Cascade asks you to sign in on first use. If your Windsurf version cannot finish the sign-in, add `"headers": { "Authorization": "Bearer YOUR_MEETSTREAM_API_KEY" }`.

```json
{
  "mcpServers": {
    "meetstream": { "serverUrl": "https://mcp.meetstream.ai/mcp" }
  }
}
```

### Codex

Add to `~/.codex/config.toml`, then run `codex mcp login meetstream`. With a key instead, add `bearer_token_env_var = "MEETSTREAM_API_KEY"`.

```toml
[mcp_servers.meetstream]
url = "https://mcp.meetstream.ai/mcp"
```

### Clients that only speak the old HTTP+SSE transport

Use `https://mcp.meetstream.ai/sse` with the same sign-in or key options. Everything else uses `/mcp`, whose replies already stream as server-sent events.

### Use the MCP before

- calling any MeetStream endpoint
- adding or changing a command's request or response handling
- changing webhook handling or event names
- relying on any request field, response field, provider name or status code

## Working in this repo

Node **>= 18.17**, ESM (`"type": "module"`), zero build step. Source runs as written. Commands are built with `commander`.

```sh
npm install

npm test                     # node --test over test/*.test.js
node bin/meetstream.js --help
npm link                     # puts `meetstream` on your PATH for manual testing
```

`npm test` needs **no API key and no network** - `test/api.test.js` covers the client layer. Run it before every commit.

Drive the real CLI against the API with:

```sh
export MEETSTREAM_API_KEY=ms_...
node bin/meetstream.js auth status
node bin/meetstream.js bot list
```

### Layout

| Path | Purpose |
|---|---|
| `bin/meetstream.js` | entry point, command registration |
| `src/commands/bot.js` | bot lifecycle, media, interaction |
| `src/commands/transcript.js` | transcript, transcriptions, transcribe |
| `src/commands/listen.js` | local webhook receiver |
| `src/commands/misc.js` | auth, calendar, MIA |
| `src/api.js` | REST client, base URL, auth header |
| `src/config.js` | key resolution and on-disk config |
| `src/output.js` | table / JSON rendering |
| `src/telemetry.js` | PostHog, opt-out aware |

Adding a command means a new or extended file under `src/commands/`, registration in `bin/meetstream.js`, and a matching section in the README.

Keep output dual-mode: human-readable by default, machine-readable under `--json`. Agents and scripts depend on the `--json` shape, so treat it as a contract and do not reshape it casually.

### Environment and config

| Variable | Default | Notes |
|---|---|---|
| `MEETSTREAM_API_KEY` | - | Wins over the config file. Get one at https://app.meetstream.ai/api-key |
| `MEETSTREAM_API_URL` | `https://api.meetstream.ai/api/v1` | Point at staging here |
| `MEETSTREAM_TELEMETRY` | on | Set `0`/`false` to disable |
| `DO_NOT_TRACK` | - | Honoured, disables telemetry |

Key resolution order: `MEETSTREAM_API_KEY`, then `~/.meetstream/config.json`. The config directory is written `0700` and the file `0600`; keep it that way. Never print a key in full - mask it the way `auth status` does.

## API rules that are easy to get wrong

These are live-verified. Do not "fix" code that follows them.

- **Auth differs by surface.** The REST API at `api.meetstream.ai` uses `Authorization: Token <key>`. The MCP server at `mcp.meetstream.ai` uses `Authorization: Bearer <key>`. This CLI talks to REST, so it sends `Token`.
- Every webhook carries the event name under **`event`**, and most also carry **`bot_event`** with the specific name.
- **Terminals are two-layer.** Every ending arrives once with `event: "bot.stopped"`; `bot_event` says why (`bot.stopped`, `bot.kicked`, `bot.notallowed`, `bot.denied`, `bot.failed`). Lobby timeouts, denials and failures carry `status_code: 500`, clean exits and kicks `200`. Branch on `bot_event`: a kick and a clean exit both report `bot_status: "Stopped"`.
- Every event carries a `timestamp`.
- **Streaming-only providers produce no post-call transcript**: no `transcription.processed`, though `bot.done` still fires. A post-call transcript fetch for them returns `202` indefinitely, so any polling loop needs a cap.
- Over REST, transcripts are fetched by **`transcript_id`**, not `bot_id`. The MCP `get_transcript` tool is the exception: it takes `bot_id` and resolves the `transcript_id` itself. Either way, segments use **`transcript`**, not `text`.
- **`202` and `507` are not errors.** 202 means poll again; 507 means an idempotent retry replayed and is a success.
- The bot field is **`meeting_link`**, not `meeting_url`.
- `in_call_recording_timeout` has a hard floor of **600 seconds**; below it the API returns 400.
- **Build tracks, in this order.** 1. Recording bot is the default: 1a non-realtime transcription (post-call: create the bot, wait for Done, get the transcript and recordings; webhooks) or 1b real-time transcription (live transcription webhook, real-time audio WebSocket, meeting control socket, chat, raise or lower hand); ask once: after the call, or live? 2. Bridge server (the user's own stack, local): the bot connects out over two WebSockets (`live_audio_required.websocket_url` for audio in, `socket_connection_url.websocket_url` for audio, chat and images out); on a laptop, expose the server with a local tunnel (ngrok, cloudflared); the user runs their own speech-to-text, LLM and text-to-speech, free local models included (whisper.cpp / faster-whisper, Parakeet, Vosk, Moonshine; Ollama, LM Studio or llama.cpp; Piper, Kokoro, Chatterbox, macOS `say`; free to run locally, check each model's license before commercial use); bot price only; see https://docs.meetstream.ai/guides/websockets/bridge-server-architecture and the starter https://github.com/meetstream-ai/meetstream-agent. 3. Agents API infra (MIA, hosted by MeetStream; bot price + $0.25/h agent infrastructure + models): 3a MeetStream's own, default keys (`key_source: "meetstream"`, pipeline mode only: Deepgram speech-to-text, OpenAI LLM and voice; realtime mode needs the user's own OpenAI key), recommended for "just host it"; 3b bring your own agent infra (LiveKit) is COMING SOON, give no setup steps; 3c bring your own keys; 3d local agent (the user's own agent CLI through `model.provider: "local_agent"` and the Agent Kit) is COMING SOON, not in production: never present it as available or give setup steps, and when you describe it, say meeting speech will reach an agent with access to the user's computer and terminal (prompt injection). If the user wants an agent but does not say which, ask once: run your own stack (track 2), or let MeetStream host it (track 3a or 3c)? Overview: https://docs.meetstream.ai/guides/introduction/integration-paths
- **Voice agent keys.** `key_source: "meetstream"` on `transcriber`, `model` and `voice` (pipeline mode, no `api_key`) uses MeetStream's inbuilt keys; `"user"` or omitted uses the customer's own keys. Inbuilt keys work in pipeline mode only: Deepgram (speech-to-text) and OpenAI (LLM and voice). Realtime mode runs on OpenAI and needs your own OpenAI key. Any other provider: bring your own key. While inbuilt keys are not on for an account, the API returns 400 `MeetStream-managed keys are not available for <section>. Use your own key.`: switch that section to the customer's own key (3c), do not retry.
- **A failed transcript is `422`**, with `message`, `transcript_status: "Failed"` and `transcript_id`. It is final: surface the reason, never poll it.
- MIA bots take **only `agent_config_id`**. Adding `socket_connection_url` or `live_audio_required` alongside it is the usual cause of a silent agent. A bridge server (track 2) is a separate bot.
- **Video is off by default.** Send `"video_required": false` on every bot unless the user explicitly asks to record video. Transcripts, diarization and speaker timelines all work without it.
- **When video is on, send a layout.** `recording_config.video_layout` defaults to `"grid_view"`, so pass `"speaker_view"` explicitly unless the user asks for grid or gallery view. It is ignored when video is off. Google Meet, Teams and Zoom accept `"speaker_view"` and `"grid_view"`; Google Meet and Teams also accept `"speaker_view_default"` and `"grid_view_default"`; WhatsApp accepts only `"grid_view"`.
- **Per-participant video is opt-in only.** Never set `video_separate_streams` (top level or under `recording_config`) unless the user explicitly asks for per-participant video streams. Per-participant audio (`audio_separate_streams`) is unaffected.

## Security

- Never hard-code or commit a key. `ms_...` values belong in the environment or `~/.meetstream/config.json`.
- Never log a key, a transcript, or participant data.
- Preserve the restrictive permissions on the config file.
- Verify webhook signatures before acting on a payload in `listen`.
- Do not persist meeting, transcript, participant or recording data unless asked.

## Before you finish

- `npm test` passes.
- `node bin/meetstream.js --help` still renders, and any new command is documented in the README.
- `--json` output shape is unchanged, or the change is called out explicitly.
- State which MCP tools or docs you relied on, what changed, and what you did not verify.

## Related

- Docs: https://docs.meetstream.ai · CLI docs: https://docs.meetstream.ai/build-with-ai/meetstream-cli
- MCP server: https://github.com/meetstream-ai/meetstream-mcp (hosted at `https://mcp.meetstream.ai/mcp`)
- Claude Code plugin: https://github.com/meetstream-ai/claude-plugin
- Cursor plugin: https://github.com/meetstream-ai/meetstream-cursor-plugin
- Runnable examples: https://github.com/meetstream-ai/labs
