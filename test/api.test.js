// Unit tests for the API client - mocked fetch, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeetStreamClient, buildCreateBotPayload, signedInWarnings } from '../src/api.js';
import { resolvePassword } from '../src/secrets.js';

function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    for (const [pattern, resp] of routes) {
      if (url.includes(pattern)) {
        return {
          ok: (resp.status || 200) < 400,
          status: resp.status || 200,
          text: async () => JSON.stringify(resp.body ?? {}),
        };
      }
    }
    return { ok: false, status: 404, text: async () => '{"detail":"not found"}' };
  };
  fn.calls = calls;
  return fn;
}

test('auth header uses Token scheme', async () => {
  const f = mockFetch([['/bots', { body: { bots: [] } }]]);
  const c = new MeetStreamClient('KEY123', { fetchImpl: f });
  await c.listBots();
  assert.equal(f.calls[0].init.headers.Authorization, 'Token KEY123');
  assert.match(f.calls[0].url, /\/api\/v1\/bots$/);
});

test('createBot passes Idempotency-Key and treats 507 replay as success', async () => {
  const f = mockFetch([['/bots/create_bot', { status: 507, body: { bot_id: 'orig' } }]]);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  const { status, data } = await c.createBot({ meeting_link: 'x', bot_name: 'b' }, { idempotencyKey: 'uuid-1' });
  assert.equal(status, 507);
  assert.equal(data.bot_id, 'orig');
  assert.equal(f.calls[0].init.headers['Idempotency-Key'], 'uuid-1');
});

test('remove_bot is a GET and delete uses DELETE /delete', async () => {
  const f = mockFetch([['/remove_bot', { body: {} }], ['/delete', { body: {} }]]);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  await c.removeBot('b1');
  await c.deleteBotData('b1');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.match(f.calls[0].url, /\/bots\/b1\/remove_bot$/);
  assert.equal(f.calls[1].init.method, 'DELETE');
  assert.match(f.calls[1].url, /\/bots\/b1\/delete$/);
});

test('transcript resolution: detail → transcript_id → /transcript/{id}/get_transcript', async () => {
  const f = mockFetch([
    ['/bots/b1/detail', { body: { bot_details: { transcript_id: 'T9' } } }],
    ['/transcript/T9/get_transcript', { body: [{ speaker: 'A', transcript: 'hello' }] }],
  ]);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  const { transcript_id, transcript } = await c.getTranscript('b1');
  assert.equal(transcript_id, 'T9');
  assert.equal(transcript[0].transcript, 'hello');
  assert.match(f.calls[1].url, /raw=false/);
});

test('transcript resolution falls back to /transcriptions when detail has no id', async () => {
  const f = mockFetch([
    ['/bots/b1/detail', { body: { bot_details: {} } }],
    ['/bots/b1/transcriptions', { body: { transcriptions: [{ transcript_id: 'T2', status: 'Success' }] } }],
    ['/transcript/T2/get_transcript', { body: [{ speaker: 'B', transcript: 'yo' }] }],
  ]);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  const { transcript_id } = await c.getTranscript('b1');
  assert.equal(transcript_id, 'T2');
});

test('calendar connect uses underscore endpoint + google_* fields', async () => {
  const f = mockFetch([['/calendar/create_calendar', { body: {} }]]);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  await c.connectCalendar({ clientId: 'a', clientSecret: 'b', refreshToken: 'r' });
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.google_client_id, 'a');
  assert.equal(body.google_refresh_token, 'r');
  assert.match(f.calls[0].url, /create_calendar$/);
});

test('buildCreateBotPayload: safe defaults + provider shapes + timeout floor', () => {
  const p = buildCreateBotPayload({
    meetingLink: 'https://meet.google.com/x', name: 'N', transcript: 'assemblyai',
    permissionDeniedTimeout: 10, attrs: { a: '1' }, socketWs: 'wss://x',
  });
  assert.equal(p.meeting_link, 'https://meet.google.com/x');
  assert.equal(p.video_required, false);
  // assemblyai uses speech_models[] + language_code (NOT model/language)
  assert.ok(Array.isArray(p.recording_config.transcript.provider.assemblyai.speech_models));
  assert.ok(p.recording_config.transcript.provider.assemblyai.language_code);
  // recording_permission_denied_timeout min is 60 (lower → HTTP 400)
  assert.equal(p.automatic_leave.recording_permission_denied_timeout, 60);
  // socket_connection_url takes websocket_url (not url)
  assert.equal(p.socket_connection_url.websocket_url, 'wss://x');
  assert.deepEqual(p.custom_attributes, { a: '1' });
});

test('API errors surface status + detail', async () => {
  const f = mockFetch([['/bots/bad/status', { status: 401, body: { detail: 'Invalid token' } }]]);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  await assert.rejects(() => c.botStatus('bad'), (e) => e.status === 401 && /Invalid token/.test(e.message));
});

test('live shape: transcript wrapped in message key is unwrapped', async () => {
  const f = mockFetch([
    ['/bots/b1/detail', { body: { bot_details: { transcript_id: 'T5' } } }],
    ['/transcript/T5/get_transcript', { body: { message: [{ speaker: 'Sid', transcript: 'pricing?' }] } }],
  ]);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  const { transcript } = await c.getTranscript('b1');
  assert.equal(transcript[0].speaker, 'Sid');
});

test('buildCreateBotPayload: Zoom authenticated joins use zak_url / obf_url', () => {
  const zak = buildCreateBotPayload({ meetingLink: 'https://zoom.us/j/1', zoomZakUrl: 'https://x.example/zak' });
  assert.deepEqual(zak.zoom, { zak_url: 'https://x.example/zak' });
  const obf = buildCreateBotPayload({ meetingLink: 'https://zoom.us/j/1', zoomObfUrl: 'https://x.example/obf' });
  assert.deepEqual(obf.zoom, { obf_url: 'https://x.example/obf' });
  assert.equal(buildCreateBotPayload({ meetingLink: 'https://zoom.us/j/1' }).zoom, undefined);
});

test('buildCreateBotPayload: the removed --zoom-obf flag fails loudly instead of sending use_zoom_obf', () => {
  assert.throws(() => buildCreateBotPayload({ meetingLink: 'https://zoom.us/j/1', zoomObf: true }), /--zoom-obf-url/);
});

// ── Signed-in bots ──────────────────────────────────────────────────────
const TEAMS_LINK = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0';
const MEET_LINK = 'https://meet.google.com/abc-defg-hij';

test('buildCreateBotPayload: --teams-login-domain builds the teams block', () => {
  const p = buildCreateBotPayload({ meetingLink: TEAMS_LINK, teamsLoginDomain: 'bots.example.com' });
  assert.deepEqual(p.teams, { login_required: true, teams_login_domain: 'bots.example.com' });
  assert.equal(p.google_meet, undefined);
});

test('buildCreateBotPayload: --google-login-domain builds the google_meet block', () => {
  const p = buildCreateBotPayload({ meetingLink: MEET_LINK, googleLoginDomain: 'example.com' });
  assert.deepEqual(p.google_meet, { login_required: true, google_login_domain: 'example.com' });
  assert.equal(p.teams, undefined);
});

test('buildCreateBotPayload: --sign-in-email pins an account, strict_email defaults true, --no-strict-email sends false', () => {
  const strict = buildCreateBotPayload({ meetingLink: TEAMS_LINK, teamsLoginDomain: 'bots.example.com', signInEmail: 'bot1@bots.example.com', strictEmail: true });
  assert.deepEqual(strict.teams, { login_required: true, teams_login_domain: 'bots.example.com', sign_in_email: 'bot1@bots.example.com', strict_email: true });
  const loose = buildCreateBotPayload({ meetingLink: MEET_LINK, googleLoginDomain: 'example.com', signInEmail: 'bot@example.com', strictEmail: false });
  assert.deepEqual(loose.google_meet, { login_required: true, google_login_domain: 'example.com', sign_in_email: 'bot@example.com', strict_email: false });
});

test('buildCreateBotPayload: no signed-in flags -> no teams / google_meet block (commander default strictEmail=true is ignored)', () => {
  const p = buildCreateBotPayload({ meetingLink: MEET_LINK, strictEmail: true });
  assert.equal(p.teams, undefined);
  assert.equal(p.google_meet, undefined);
});

test('buildCreateBotPayload: signed-in flag misuse is a usage error (exit 2)', () => {
  const isUsage = (re) => (e) => e.exitCode === 2 && re.test(e.message);
  assert.throws(() => buildCreateBotPayload({ meetingLink: TEAMS_LINK, signInEmail: 'a@b.com' }), isUsage(/--sign-in-email needs/));
  assert.throws(() => buildCreateBotPayload({ meetingLink: TEAMS_LINK, teamsLoginDomain: 'a.com', googleLoginDomain: 'b.com' }), isUsage(/not both/));
  assert.throws(() => buildCreateBotPayload({ meetingLink: TEAMS_LINK, teamsLoginDomain: 'a.com', strictEmail: false }), isUsage(/--no-strict-email/));
  assert.throws(() => buildCreateBotPayload({ meetingLink: TEAMS_LINK, strictEmail: false }), isUsage(/--no-strict-email/));
});

test('signedInWarnings: host mismatch warns (but is not an error), Teams always warns about name/avatar', () => {
  const teamsOk = signedInWarnings({ meetingLink: TEAMS_LINK, teamsLoginDomain: 'bots.example.com' });
  assert.equal(teamsOk.length, 1);
  assert.match(teamsOk[0], /display name and picture/);
  const teamsOnMeet = signedInWarnings({ meetingLink: MEET_LINK, teamsLoginDomain: 'bots.example.com' });
  assert.ok(teamsOnMeet.some((w) => /not a Microsoft Teams host/.test(w)));
  const live = signedInWarnings({ meetingLink: 'https://teams.live.com/meet/123', teamsLoginDomain: 'bots.example.com' });
  assert.ok(live.some((w) => /personal Teams/.test(w)));
  assert.deepEqual(signedInWarnings({ meetingLink: MEET_LINK, googleLoginDomain: 'example.com' }), []);
  const googleOnTeams = signedInWarnings({ meetingLink: TEAMS_LINK, googleLoginDomain: 'example.com' });
  assert.ok(googleOnTeams.some((w) => /not meet\.google\.com/.test(w)));
  assert.deepEqual(signedInWarnings({ meetingLink: MEET_LINK }), []);
});

function jsonMock(body = {}, status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  fn.calls = calls;
  return fn;
}

test('Teams login domains: create forces login_mode always, get/patch/delete encode the domain', async () => {
  const f = jsonMock({ domain: 'bots.example.com' }, 201);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  await c.teamsDomainCreate({ domain: 'bots.example.com', name: 'Bots' });
  await c.teamsDomainsList();
  await c.teamsDomainGet('bots.example.com');
  await c.teamsDomainUpdate('bots.example.com', { name: 'Renamed' });
  await c.teamsDomainDelete('bots.example.com');
  assert.deepEqual(f.calls.map((x) => [x.method, x.url.replace(/^.*\/api\/v1/, '')]), [
    ['POST', '/teams-login-domains'],
    ['GET', '/teams-login-domains'],
    ['GET', '/teams-login-domains/bots.example.com'],
    ['PATCH', '/teams-login-domains/bots.example.com'],
    ['DELETE', '/teams-login-domains/bots.example.com'],
  ]);
  assert.deepEqual(f.calls[0].body, { domain: 'bots.example.com', name: 'Bots', login_mode: 'always' });
  assert.deepEqual(f.calls[3].body, { name: 'Renamed' });
});

test('Teams logins: list needs ?domain=, create sends the password in the body only, patch/delete by login_id', async () => {
  const f = jsonMock({ login_id: 'L1' });
  const c = new MeetStreamClient('K', { fetchImpl: f });
  await c.teamsLoginsList('bots.example.com');
  await c.teamsLoginCreate({ domain: 'bots.example.com', email: 'bot1@bots.example.com', password: 'PLACEHOLDER' });
  await c.teamsLoginGet('L1');
  await c.teamsLoginUpdate('L1', { password: 'PLACEHOLDER2' });
  await c.teamsLoginUpdate('L1', { isActive: false });
  await c.teamsLoginDelete('L1');
  assert.match(f.calls[0].url, /\/teams-logins\?domain=bots\.example\.com$/);
  assert.equal(f.calls[1].method, 'POST');
  assert.doesNotMatch(f.calls[1].url, /PLACEHOLDER/);
  assert.deepEqual(f.calls[1].body, { domain: 'bots.example.com', email: 'bot1@bots.example.com', password: 'PLACEHOLDER' });
  assert.match(f.calls[2].url, /\/teams-logins\/L1$/);
  assert.deepEqual(f.calls[3].body, { password: 'PLACEHOLDER2' });
  assert.deepEqual(f.calls[4].body, { is_active: false });
  assert.equal(f.calls[5].method, 'DELETE');
});

test('Teams API errors surface the server error message', async () => {
  const f = jsonMock({ error: 'Domain bots.example.com not registered' }, 404);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  await assert.rejects(() => c.teamsLoginsList('bots.example.com'), (e) => e.status === 404 && /not registered/.test(e.message));
});

test('Google login domains use sso_workspace_domain; logins use PEMs and need the domain for patch/delete', async () => {
  const f = jsonMock({});
  const c = new MeetStreamClient('K', { fetchImpl: f });
  await c.googleDomainCreate({ domain: 'example.com', name: 'Acme' });
  await c.googleDomainUpdate('example.com', { loginMode: 'if_required' });
  await c.googleDomainDelete('example.com');
  await c.googleLoginsList('example.com');
  await c.googleLoginCreate({ domain: 'example.com', email: 'bot@example.com', privateKeyPem: 'KEY', certPem: 'CERT' });
  await c.googleLoginUpdate('G1', { domain: 'example.com', isActive: true });
  await c.googleLoginDelete('G1', 'example.com');
  assert.deepEqual(f.calls[0].body, { sso_workspace_domain: 'example.com', name: 'Acme', login_mode: 'always' });
  assert.deepEqual(f.calls[1].body, { login_mode: 'if_required' });
  assert.match(f.calls[2].url, /\/google-login-domains\/example\.com$/);
  assert.match(f.calls[3].url, /\/google-logins\?domain=example\.com$/);
  assert.deepEqual(f.calls[4].body, { domain: 'example.com', email: 'bot@example.com', sso_private_key_pem: 'KEY', sso_cert_pem: 'CERT' });
  assert.deepEqual([f.calls[5].method, f.calls[5].body], ['PATCH', { domain: 'example.com', is_active: true }]);
  assert.equal(f.calls[6].method, 'DELETE');
  assert.match(f.calls[6].url, /\/google-logins\/G1\?domain=example\.com$/);
});

test('resolvePassword: --password-stdin, then env var, then TTY prompt; refuses otherwise', async () => {
  const never = async () => { throw new Error('should not be called'); };
  assert.equal(await resolvePassword({ passwordStdin: true, read: async () => 'from-stdin', prompt: never, env: { MEETSTREAM_LOGIN_PASSWORD: 'from-env' } }), 'from-stdin');
  assert.equal(await resolvePassword({ env: { MEETSTREAM_LOGIN_PASSWORD: 'from-env' }, read: never, prompt: never, isTTY: true }), 'from-env');
  assert.equal(await resolvePassword({ env: {}, isTTY: true, read: never, prompt: async () => 'typed' }), 'typed');
  await assert.rejects(() => resolvePassword({ env: {}, isTTY: false, read: never, prompt: never }), (e) => e.exitCode === 2 && /--password-stdin/.test(e.message));
  await assert.rejects(() => resolvePassword({ passwordStdin: true, read: async () => '', env: {} }), /empty/);
});
