# Changelog

All notable changes to `@meetstream/cli`.

## 0.6.1 (2026-11-21)

### Fixed

- `meetstream transcript` printed `Unknown:` lines with no text: it read `speaker` / `transcript`, but segments name the speaker in `participant.name` and hold the text in `words[].text`. It now reads this shape (and the flat shape), and skips segments with no text.
- Zoom help text: `bot create` says Zoom bots join through your Zoom app with an OBF or ZAK token (`--zoom-obf-url` / `--zoom-zak-url`). `--zoom-use-own-app` / `--no-zoom-use-own-app` stay and now say which `use_own_app` value they send; the text no longer says Zoom needs no setup.
- README and AGENTS.md state MeetStream's inbuilt keys per mode: Pipeline: OpenAI + Deepgram (Deepgram speech-to-text; OpenAI LLM and voice). Realtime: OpenAI only. Any other provider: bring your own key.
- Removed an internal ticket reference from a test comment.

## 0.6.0 (2026-11-21)

Matches MeetStream API v1.10.0.

### Added

- Agents API: `mia get`, `mia update <id> -f <file>` (`PUT`, whole blocks), `mia check <id>` (local agent bridge test, `GET /mia?check=local_agent`). `agents` is an alias of `mia`.
- `bot create --agent-config <id>` (alias of `--agent-config-id`) and `--agent-param key=value` for `agent_config_params`. A warning on stderr when `--socket-ws` or `--live-audio-ws` is sent with an agent.
- `balance`: prepaid balance from `GET /api/v1/billing/balance`. Available when the endpoint is on for the account; a `404` prints where to see the balance (https://app.meetstream.ai/billing) and exits 3.
- A failed transcript (`422`) prints `Transcript failed: <reason>` and the next step (`meetstream transcribe <bot-id>`), exits 4, and is never polled with `--wait`. With `--json`: `{"error": "transcript_failed", "reason", "transcript_status", "transcript_id"}`.
- A hint when the API refuses MeetStream's inbuilt keys (`MeetStream-managed keys are not available ...`): use your own key for that section.

### Changed

- `mia create` tells you to attach the agent with `--agent-config` only (it no longer suggests `--socket-ws` / `--live-audio-ws`).
- `bot audio` / `bot video` help: download links are valid for 1 hour.
- README opens with the two ways to integrate, a fastest path for each, the voice agent setups with prices, and a "Latest docs" section.

## 0.5.0 (2026-11-18)

- `bot raise-hand` / `bot lower-hand`, `bot create --zoom-use-own-app` / `--no-zoom-use-own-app` / `--storage-id`, Smallest AI providers, `bot timeline --download`, `Retry-After` on `429`, `/screenshots` and `/calendar/calendars` routes, `bot summary` removed (points to `transcript`).

## 0.4.2 and earlier

See the git history.
