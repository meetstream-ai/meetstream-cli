// MeetStream API client - mirrors the live OpenAPI spec (https://docs.meetstream.ai/openapi.json)
// Auth: `Authorization: Token <key>` · Base: https://api.meetstream.ai/api/v1
import { BASE_URL } from './config.js';

export class ApiError extends Error {
  constructor(message, { status, body, path } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

export class MeetStreamClient {
  constructor(apiKey, { baseUrl = BASE_URL, fetchImpl = fetch } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  async request(method, path, { body, headers = {}, query } = {}) {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams(query).toString();
      if (qs) url += `?${qs}`;
    }
    const res = await this.fetch(url, {
      method,
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    // 507 = idempotent replay of an existing bot - a success, not an error.
    if (!res.ok && res.status !== 507) {
      const detail = typeof data === 'object' && data !== null
        ? (data.detail || data.message || data.error || JSON.stringify(data))
        : String(data).slice(0, 300);
      throw new ApiError(`${method} ${path} → HTTP ${res.status}: ${detail}`, {
        status: res.status, body: data, path,
      });
    }
    return { status: res.status, data };
  }

  // ── Bots ──────────────────────────────────────────────────────────────
  createBot(payload, { idempotencyKey } = {}) {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
    return this.request('POST', '/bots/create_bot', { body: payload, headers });
  }
  listBots() { return this.request('GET', '/bots'); }
  botStatus(botId) { return this.request('GET', `/bots/${botId}/status`); }
  botDetail(botId) { return this.request('GET', `/bots/${botId}/detail`); }
  botSummary(botId) { return this.request('GET', `/bots/${botId}/summary`); }
  botAudio(botId) { return this.request('GET', `/bots/${botId}/get_audio`); }
  botVideo(botId) { return this.request('GET', `/bots/${botId}/get_video`); }
  recordingStreams(botId) { return this.request('GET', `/bots/${botId}/get_recording_streams`); }
  audioStreams(botId) { return this.request('GET', `/bots/${botId}/get_audio_streams`); }
  speakerTimeline(botId) { return this.request('GET', `/bots/${botId}/get_speaker_timeline`); }
  chats(botId) { return this.request('GET', `/bots/${botId}/get_chats`); }
  screenshots(botId) { return this.request('GET', `/bots/${botId}/get_screenshots`); }
  participants(botId) { return this.request('GET', `/bots/${botId}/get_participants`); }
  removeBot(botId) { return this.request('GET', `/bots/${botId}/remove_bot`); } // GET, not DELETE
  deleteBotData(botId) { return this.request('DELETE', `/bots/${botId}/delete`); }
  sendMessage(botId, message, metadata) {
    return this.request('POST', `/bots/${botId}/send_message`, { body: { message, ...(metadata ? { metadata } : {}) } });
  }
  sendImage(botId, imgUrl, displayDuration, metadata) {
    return this.request('POST', `/bots/${botId}/send_image`, {
      body: { img_url: imgUrl, ...(displayDuration ? { display_duration: displayDuration } : {}), ...(metadata ? { metadata } : {}) },
    });
  }

  // ── Transcription ─────────────────────────────────────────────────────
  transcriptions(botId) { return this.request('GET', `/bots/${botId}/transcriptions`); }
  transcribe(botId, provider, callbackUrl) {
    return this.request('POST', `/bots/${botId}/transcribe`, {
      body: { provider, ...(callbackUrl ? { callback_url: callbackUrl } : {}) },
    });
  }
  getTranscriptById(transcriptId, { raw = false } = {}) {
    return this.request('GET', `/transcript/${transcriptId}/get_transcript`, { query: { raw: String(raw) } });
  }

  /**
   * Resolve a bot's transcript_id. transcript_id is NOT delivered in webhooks -
   * canonical sources: GET /bots/{id}/detail (bot_details.transcript_id),
   * the create_bot response, or GET /bots/{id}/transcriptions.
   */
  async resolveTranscriptId(botId) {
    try {
      const { data } = await this.botDetail(botId);
      const tid = data?.bot_details?.transcript_id || data?.transcript_id;
      if (tid) return tid;
    } catch { /* fall through to /transcriptions */ }
    const { data } = await this.transcriptions(botId);
    const items = data?.transcriptions || [];
    const done = items.find((t) => /success|completed/i.test(t.status || '')) || items[0];
    return done?.transcript_id || null;
  }

  /** Fetch a bot's transcript, optionally polling until it is ready. */
  async getTranscript(botId, { raw = false, wait = false, timeoutMs = 600_000, intervalMs = 5000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    // one immediate attempt, then poll if wait=true
    for (;;) {
      const tid = await this.resolveTranscriptId(botId);
      if (tid) {
        try {
          const { data } = await this.getTranscriptById(tid, { raw });
          // Live API may wrap segments in a `message` key: { message: [ {speaker, transcript, ...} ] }
          const segments = Array.isArray(data) ? data : (Array.isArray(data?.message) ? data.message : data);
          if (segments && (Array.isArray(segments) ? segments.length : true)) {
            return { transcript_id: tid, transcript: segments };
          }
        } catch (e) {
          if (!wait || (e.status && e.status !== 404 && e.status !== 400)) throw e;
        }
      }
      if (!wait || Date.now() > deadline) {
        if (!wait) return { transcript_id: tid, transcript: null };
        throw new ApiError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for transcript of bot ${botId}`, { path: `/bots/${botId}` });
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  // ── Calendar ──────────────────────────────────────────────────────────
  connectCalendar({ clientId, clientSecret, refreshToken }) {
    return this.request('POST', '/calendar/create_calendar', {
      body: { google_client_id: clientId, google_client_secret: clientSecret, google_refresh_token: refreshToken },
    });
  }
  disconnectCalendar({ clientId, clientSecret, refreshToken }) {
    return this.request('POST', '/calendar/disconnect', {
      body: { google_client_id: clientId, google_client_secret: clientSecret, google_refresh_token: refreshToken },
    });
  }
  listCalendars() { return this.request('GET', '/calendar'); }
  calendarEvents() { return this.request('GET', '/calendar/events'); }
  scheduleEvent(eventId) { return this.request('POST', `/calendar/schedule/${eventId}`); }
  unscheduleEvent(eventId) { return this.request('DELETE', `/calendar/schedule/${eventId}`); }
  toggleRecurrence(eventId, enabled) {
    return this.request('POST', '/calendar/toggle-recurrence', { body: { event_id: eventId, recurring_enabled: enabled } });
  }
  autoScheduleEnable(defaultBotConfig) {
    return this.request('POST', '/calendar/auto-schedule/enable', { body: { default_bot_config: defaultBotConfig } });
  }
  autoScheduleDisable(defaultBotConfig) {
    return this.request('POST', '/calendar/auto-schedule/disable', { body: { default_bot_config: defaultBotConfig || {} } });
  }
  rescheduleBot(botId, joinTime) {
    return this.request('PATCH', `/calendar/scheduled_bots/${botId}`, { body: { scheduled_join_time: joinTime } });
  }
  deleteScheduledBot(botId) { return this.request('DELETE', `/calendar/scheduled_bots/${botId}`); }

  // ── MIA (conversational agents) ───────────────────────────────────────
  miaList() { return this.request('GET', '/mia'); }
  miaCreate(config) { return this.request('POST', '/mia', { body: config }); }
  miaUpdate(config) { return this.request('PUT', '/mia', { body: config }); }
  miaDelete(agentConfigId) { return this.request('DELETE', '/mia', { query: { agent_config_id: agentConfigId } }); }

  // ── Signed-in bots: Microsoft Teams logins ────────────────────────────
  // Passwords are write-only: sent in the request body, never returned, never logged.
  teamsDomainsList() { return this.request('GET', '/teams-login-domains'); }
  teamsDomainGet(domain) { return this.request('GET', `/teams-login-domains/${enc(domain)}`); }
  teamsDomainCreate({ domain, name } = {}) {
    // login_mode "if_required" is not supported for Teams yet; always use "always".
    return this.request('POST', '/teams-login-domains', {
      body: { domain, ...(name ? { name } : {}), login_mode: 'always' },
    });
  }
  teamsDomainUpdate(domain, { name } = {}) {
    return this.request('PATCH', `/teams-login-domains/${enc(domain)}`, { body: { ...(name ? { name } : {}) } });
  }
  teamsDomainDelete(domain) { return this.request('DELETE', `/teams-login-domains/${enc(domain)}`); }
  teamsLoginsList(domain) { return this.request('GET', '/teams-logins', { query: { domain } }); }
  teamsLoginGet(loginId) { return this.request('GET', `/teams-logins/${enc(loginId)}`); }
  teamsLoginCreate({ domain, email, password, isActive } = {}) {
    return this.request('POST', '/teams-logins', {
      body: { domain, email, password, ...(isActive !== undefined ? { is_active: Boolean(isActive) } : {}) },
    });
  }
  teamsLoginUpdate(loginId, { password, isActive } = {}) {
    const body = {};
    if (password !== undefined) body.password = password; // a new password also reactivates the account
    if (isActive !== undefined) body.is_active = Boolean(isActive);
    return this.request('PATCH', `/teams-logins/${enc(loginId)}`, { body });
  }
  teamsLoginDelete(loginId) { return this.request('DELETE', `/teams-logins/${enc(loginId)}`); }

  // ── Signed-in bots: Google Meet logins ────────────────────────────────
  // Google domains are keyed by sso_workspace_domain; logins authenticate with an
  // SSO private key + certificate (PEM), not a password. There is no GET-by-id for
  // a Google login, and PATCH/DELETE on a login need the domain.
  googleDomainsList() { return this.request('GET', '/google-login-domains'); }
  googleDomainGet(domain) { return this.request('GET', `/google-login-domains/${enc(domain)}`); }
  googleDomainCreate({ domain, name, loginMode = 'always' } = {}) {
    return this.request('POST', '/google-login-domains', {
      body: { sso_workspace_domain: domain, ...(name ? { name } : {}), login_mode: loginMode },
    });
  }
  googleDomainUpdate(domain, { name, loginMode } = {}) {
    return this.request('PATCH', `/google-login-domains/${enc(domain)}`, {
      body: { ...(name ? { name } : {}), ...(loginMode ? { login_mode: loginMode } : {}) },
    });
  }
  googleDomainDelete(domain) { return this.request('DELETE', `/google-login-domains/${enc(domain)}`); }
  googleLoginsList(domain) { return this.request('GET', '/google-logins', { query: { domain } }); }
  googleLoginCreate({ domain, email, privateKeyPem, certPem, isActive } = {}) {
    return this.request('POST', '/google-logins', {
      body: {
        domain, email, sso_private_key_pem: privateKeyPem, sso_cert_pem: certPem,
        ...(isActive !== undefined ? { is_active: Boolean(isActive) } : {}),
      },
    });
  }
  googleLoginUpdate(loginId, { domain, isActive, privateKeyPem, certPem } = {}) {
    const body = { domain };
    if (isActive !== undefined) body.is_active = Boolean(isActive);
    if (privateKeyPem !== undefined) body.sso_private_key_pem = privateKeyPem;
    if (certPem !== undefined) body.sso_cert_pem = certPem;
    return this.request('PATCH', `/google-logins/${enc(loginId)}`, { body });
  }
  googleLoginDelete(loginId, domain) {
    return this.request('DELETE', `/google-logins/${enc(loginId)}`, { query: { domain } });
  }
}

const enc = (s) => encodeURIComponent(String(s));

const TEAMS_HOSTS = ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft'];
const GOOGLE_HOSTS = ['meet.google.com'];

function linkHost(link) {
  try { return new URL(String(link)).hostname.toLowerCase(); } catch { return ''; }
}
const hostIn = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

function usageError(message) {
  return Object.assign(new Error(message), { exitCode: 2 });
}

/**
 * Validate the signed-in bot flags and build the `google_meet` / `teams` block.
 * Returns { key, block } or null when no signed-in flag is set. Throws (exitCode 2) on misuse.
 */
export function buildSignedInBlock(opts = {}) {
  const { googleLoginDomain, teamsLoginDomain, signInEmail, strictEmail } = opts;
  if (googleLoginDomain && teamsLoginDomain) {
    throw usageError('Use either --google-login-domain or --teams-login-domain, not both (one meeting, one platform).');
  }
  const domain = googleLoginDomain || teamsLoginDomain;
  if (!domain) {
    if (signInEmail) throw usageError('--sign-in-email needs --google-login-domain or --teams-login-domain.');
    if (strictEmail === false) throw usageError('--no-strict-email only applies together with --sign-in-email and a login domain flag.');
    return null;
  }
  if (strictEmail === false && !signInEmail) {
    throw usageError('--no-strict-email only applies together with --sign-in-email.');
  }
  const isTeams = Boolean(teamsLoginDomain);
  const block = { login_required: true, [isTeams ? 'teams_login_domain' : 'google_login_domain']: domain };
  if (signInEmail) {
    block.sign_in_email = signInEmail;
    block.strict_email = strictEmail !== false; // API default is true; false = fall back to any free account
  }
  return { key: isTeams ? 'teams' : 'google_meet', block };
}

/** Non-fatal warnings for signed-in bot flags (printed to stderr; the request is still sent). */
export function signedInWarnings(opts = {}) {
  const warnings = [];
  const host = linkHost(opts.meetingLink);
  if (opts.teamsLoginDomain) {
    if (!hostIn(host, TEAMS_HOSTS)) {
      warnings.push(`--teams-login-domain is set but the meeting link host is "${host || opts.meetingLink}", not a Microsoft Teams host (teams.microsoft.com / teams.live.com). Sending anyway.`);
    } else if (hostIn(host, ['teams.live.com'])) {
      warnings.push('teams.live.com is personal Teams: signed-in bots only work with Microsoft 365 work/school Teams meetings.');
    }
    warnings.push('Signed-in Teams bots show the Microsoft account\'s own display name and picture; --name and --image-url are not applied.');
  }
  if (opts.googleLoginDomain && !hostIn(host, GOOGLE_HOSTS)) {
    warnings.push(`--google-login-domain is set but the meeting link host is "${host || opts.meetingLink}", not meet.google.com. Sending anyway.`);
  }
  return warnings;
}

/** Build a create_bot payload from CLI-ish options, applying safe defaults. */
export function buildCreateBotPayload(opts) {
  const payload = {
    meeting_link: opts.meetingLink,
    bot_name: opts.name || 'MeetStream Bot',
    video_required: Boolean(opts.video),
  };
  if (opts.botMessage) payload.bot_message = opts.botMessage;
  if (opts.imageUrl) payload.bot_image_url = opts.imageUrl; // must be a PUBLIC url
  if (opts.callback) payload.callback_url = opts.callback;
  if (opts.joinAt) payload.join_at = opts.joinAt;
  if (opts.agentConfigId) payload.agent_config_id = opts.agentConfigId;
  if (opts.separateAudio) payload.audio_separate_streams = true;
  if (opts.separateVideo) payload.video_separate_streams = true;
  if (opts.zoomObf) {
    throw new Error('--zoom-obf was removed: the API rejects use_zoom_obf. Use --zoom-obf-url <https-url> or --zoom-zak-url <https-url>.');
  }
  // Authenticated Zoom joins: each URL is an HTTPS endpoint on the caller's server that returns a fresh token.
  if (opts.zoomZakUrl || opts.zoomObfUrl) {
    payload.zoom = {};
    if (opts.zoomZakUrl) payload.zoom.zak_url = opts.zoomZakUrl;
    if (opts.zoomObfUrl) payload.zoom.obf_url = opts.zoomObfUrl;
  }
  // Signed-in bots: Google Meet (google_meet) or Microsoft Teams (teams) accounts registered via `meetstream logins`.
  const signedIn = buildSignedInBlock(opts);
  if (signedIn) payload[signedIn.key] = signedIn.block;
  if (opts.liveTranscriptWebhook) payload.live_transcription_required = { webhook_url: opts.liveTranscriptWebhook };
  if (opts.liveAudioWs) payload.live_audio_required = { websocket_url: opts.liveAudioWs };
  if (opts.liveVideoWs) payload.live_video_required = { websocket_url: opts.liveVideoWs };
  if (opts.socketWs) payload.socket_connection_url = { websocket_url: opts.socketWs };
  if (opts.attrs && Object.keys(opts.attrs).length) payload.custom_attributes = opts.attrs;

  if (opts.transcript) {
    const provider = {};
    const p = opts.transcript;
    if (p === 'deepgram') provider.deepgram = { model: 'nova-3', language: opts.language || 'en', diarize: true };
    else if (p === 'assemblyai') provider.assemblyai = { speech_models: ['best'], language_code: opts.language || 'en_us', speaker_labels: true };
    else if (p === 'sarvam') provider.sarvam = { model: 'saarika:v2', language_code: opts.language || 'en-IN', mode: 'batch', with_diarization: true };
    else if (p === 'meetstream') provider.meetstream = { language: opts.language || 'auto', translate: false };
    else if (p === 'jigsawstack') provider.jigsawstack = { language: opts.language || 'auto', translate: false, by_speaker: true };
    else if (p === 'meeting_captions') provider.meeting_captions = {};
    else if (p === 'deepgram_streaming') provider.deepgram_streaming = { model: 'nova-3', language: opts.language || 'en' };
    else if (p === 'assemblyai_streaming') provider.assemblyai_streaming = {};
    else provider[p] = {};
    payload.recording_config = {
      ...(payload.recording_config || {}),
      transcript: { provider },
    };
  }
  if (opts.retentionHours) {
    payload.recording_config = {
      ...(payload.recording_config || {}),
      retention: { type: 'timed', hours: Number(opts.retentionHours) },
    };
  }

  // Sensible timeouts so bots never sit in empty meetings.
  // recording_permission_denied_timeout: Zoom-only, MINIMUM 60 (lower → HTTP 400).
  payload.automatic_leave = {
    waiting_room_timeout: Number(opts.waitingRoomTimeout ?? 300),
    everyone_left_timeout: Number(opts.everyoneLeftTimeout ?? 60),
    in_call_recording_timeout: Number(opts.maxRecordingSeconds ?? 14400),
    recording_permission_denied_timeout: Math.max(60, Number(opts.permissionDeniedTimeout ?? 60)),
  };
  return payload;
}
