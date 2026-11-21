// 0.6.0: Agents API commands, balance, failed transcript (422). Mocked fetch for the
// client; the end-to-end cases run the real CLI binary against a local stub server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MeetStreamClient, buildCreateBotPayload } from '../src/api.js';
import { failedTranscript } from '../src/output.js';

const BIN = fileURLToPath(new URL('../bin/meetstream.js', import.meta.url));

function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    for (const [pattern, resp] of routes) {
      if (url.includes(pattern)) {
        const status = resp.status || 200;
        return { ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(resp.body ?? {}) };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{"message":"not found"}' };
  };
  fn.calls = calls;
  return fn;
}

const FAILED = {
  message: 'Transcript processing failed: provider authentication was rejected. Check the API key.',
  transcript_status: 'Failed',
  transcript_id: 'T1',
};

test('mia get / update / check use GET, PUT and check=local_agent on /mia', async () => {
  const f = mockFetch([['/mia', { body: { ok: true } }]]);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  await c.miaGet('a1');
  await c.miaUpdate({ agent_config_id: 'a1', agent: { chat_input: true } });
  await c.miaCheckLocalAgent('a1');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.match(f.calls[0].url, /\/mia\?agent_config_id=a1$/);
  assert.equal(f.calls[1].init.method, 'PUT');
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { agent_config_id: 'a1', agent: { chat_input: true } });
  const u = new URL(f.calls[2].url);
  assert.equal(u.searchParams.get('check'), 'local_agent');
  assert.equal(u.searchParams.get('agent_config_id'), 'a1');
});

test('balance reads GET /billing/balance', async () => {
  const f = mockFetch([['/billing/balance', { body: { customer_type: 'pay_as_you_go', balance_usd: '9.50', currency: 'USD' } }]]);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  const { data } = await c.balance();
  assert.equal(data.balance_usd, '9.50');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.match(f.calls[0].url, /\/billing\/balance$/);
});

test('buildCreateBotPayload: agent config id and agent_config_params, no bridge fields', () => {
  const p = buildCreateBotPayload({ meetingLink: 'https://meet.google.com/a-b-c', name: 'B', agentConfigId: 'a1', agentConfigParams: { customer: 'Ana' } });
  assert.equal(p.agent_config_id, 'a1');
  assert.deepEqual(p.agent_config_params, { customer: 'Ana' });
  assert.equal(p.socket_connection_url, undefined);
  assert.equal(p.live_audio_required, undefined);
  const q = buildCreateBotPayload({ meetingLink: 'https://meet.google.com/a-b-c', name: 'B', agentConfigParams: {} });
  assert.equal(q.agent_config_params, undefined);
});

test('getTranscript --wait stops at once on a failed transcript (422)', async () => {
  const f = mockFetch([
    ['/bots/b1/detail', { body: { bot_details: { transcript_id: 'T1' } } }],
    ['/transcript/T1/get_transcript', { status: 422, body: FAILED }],
  ]);
  const c = new MeetStreamClient('K', { fetchImpl: f });
  await assert.rejects(c.getTranscript('b1', { wait: true, timeoutMs: 60_000, intervalMs: 10 }), (e) => e.status === 422);
  assert.equal(f.calls.filter((x) => x.url.includes('get_transcript')).length, 1);
});

test('failedTranscript reads reason, status and id from a 422 body only', () => {
  assert.deepEqual(failedTranscript({ status: 422, body: FAILED }), {
    reason: 'provider authentication was rejected. Check the API key.',
    transcript_status: 'Failed',
    transcript_id: 'T1',
  });
  assert.equal(failedTranscript({ status: 422, body: { message: 'x' } }), null);
  assert.equal(failedTranscript({ status: 500, body: FAILED }), null);
});

// ── end to end: the real binary against a local stub API ──

function stubApi(routes) {
  const server = createServer((req, res) => {
    const hit = routes.find(([m, p]) => req.method === m && req.url.startsWith(p));
    const [, , status, body] = hit || [null, null, 404, { message: 'Route not found' }];
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function runCli(server, args) {
  const { port } = server.address();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, MEETSTREAM_API_KEY: 'ms_test', MEETSTREAM_API_URL: `http://127.0.0.1:${port}/api/v1`, MEETSTREAM_TELEMETRY: '0', DO_NOT_TRACK: '1' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

test('e2e: transcript on a failed transcript prints the reason and the next step, exit 4', async () => {
  const server = await stubApi([
    ['GET', '/api/v1/bots/b1/detail', 200, { bot_details: { transcript_id: 'T1' } }],
    ['GET', '/api/v1/transcript/T1/get_transcript', 422, FAILED],
  ]);
  try {
    const r = await runCli(server, ['transcript', 'b1', '--wait', '--timeout', '5']);
    assert.equal(r.code, 4);
    assert.match(r.err, /Transcript failed: provider authentication was rejected/);
    assert.match(r.err, /meetstream transcribe/);
    const j = await runCli(server, ['transcript', 'b1', '--json']);
    assert.equal(j.code, 4);
    assert.equal(JSON.parse(j.out).error, 'transcript_failed');
  } finally { server.close(); }
});

test('e2e: balance prints the balance, and a 404 points to the billing page (exit 3, no crash)', async () => {
  const ok = await stubApi([['GET', '/api/v1/billing/balance', 200, { customer_type: 'pay_as_you_go', balance_usd: '9.50', currency: 'USD' }]]);
  try {
    const r = await runCli(ok, ['balance']);
    assert.equal(r.code, 0);
    assert.match(r.out, /9\.50 USD/);
  } finally { ok.close(); }
  const missing = await stubApi([]);
  try {
    const r = await runCli(missing, ['balance']);
    assert.equal(r.code, 3);
    assert.match(r.out + r.err, /not available for this account yet/);
    assert.match(r.out + r.err, /app\.meetstream\.ai\/billing/);
    const j = await runCli(missing, ['balance', '--json']);
    assert.equal(JSON.parse(j.out).error, 'balance_unavailable');
  } finally { missing.close(); }
});

test('e2e: bot create --agent-config sends agent_config_id; mia update sends agent_config_id with the file', async () => {
  const bodies = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      bodies.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
      res.writeHead(req.url.includes('create_bot') ? 201 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ bot_id: 'b1', status: 'Active', message: 'ok' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-'));
  const file = join(dir, 'agent.json');
  writeFileSync(file, JSON.stringify({ agent: { quiet_actions: true } }));
  try {
    const a = await runCli(server, ['bot', 'create', 'https://meet.google.com/a-b-c', '--agent-config', 'cfg1', '--agent-param', 'customer=Ana', '--json']);
    assert.equal(a.code, 0, a.err);
    const u = await runCli(server, ['mia', 'update', 'cfg1', '-f', file, '--json']);
    assert.equal(u.code, 0, u.err);
  } finally { server.close(); }
  const create = bodies.find((b) => b.url.endsWith('/bots/create_bot'));
  assert.equal(create.body.agent_config_id, 'cfg1');
  assert.deepEqual(create.body.agent_config_params, { customer: 'Ana' });
  const put = bodies.find((b) => b.method === 'PUT');
  assert.deepEqual(put.body, { agent: { quiet_actions: true }, agent_config_id: 'cfg1' });
});
