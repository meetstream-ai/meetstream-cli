// Unit tests for the API client — mocked fetch, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeetStreamClient, buildCreateBotPayload } from '../src/api.js';

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
