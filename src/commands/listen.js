// `meetstream listen` - local webhook receiver for MeetStream lifecycle events.
// Verified against 4,139 captured webhooks: every delivery carries `event`, most
// also carry `bot_event`. Terminals are two-layer: every ending arrives once as
// event "bot.stopped" and bot_event says why (bot.stopped | bot.kicked |
// bot.notallowed | bot.denied | bot.failed). bot.done is the final event.
// Branch on bot_event: a kick and a clean exit both report bot_status "Stopped".
import { createServer } from 'node:http';
import { bold, dim, green, yellow, red, cyan } from '../output.js';

const TERMINAL = new Set(['bot.stopped', 'bot.done']);
const FAILY = /denied|notallowed|failed|error/i;
const ABNORMAL_STOP = new Set(['bot.kicked', 'bot.notallowed', 'bot.denied', 'bot.failed']);

function stopReason(payload) {
  if (payload?.bot_event) return payload.bot_event;
  const st = String(payload?.bot_status || '').toLowerCase();
  if (st === 'notallowed') return 'bot.notallowed';
  if (st === 'denied') return 'bot.denied';
  if (st === 'error' || st === 'failed') return 'bot.failed';
  return 'bot.stopped';
}

function colorFor(event, payload) {
  if (event === 'transcription.failed') return red;
  if (event === 'bot.stopped' && ABNORMAL_STOP.has(stopReason(payload))) return red;
  if (FAILY.test(payload?.bot_status || '')) return red;
  if (TERMINAL.has(event)) return yellow;
  if (/\.processed$|manifest\.completed/.test(event)) return green;
  return cyan;
}

export function registerListenCommand(program) {
  program
    .command('listen')
    .description('Run a local webhook receiver and pretty-print MeetStream events (use ngrok to expose it)')
    .option('-p, --port <port>', 'port to listen on', '3333')
    .option('--path <path>', 'webhook path', '/webhook')
    .option('--forward <url>', 'also relay each event to another URL')
    .option('--json', 'print raw JSON lines instead of pretty output')
    .action(async (opts) => {
      const port = Number(opts.port);
      const server = createServer(async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(200).end('meetstream listen'); return; }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}'); // respond fast, process after
        let payload;
        try { payload = JSON.parse(raw); } catch { payload = { raw }; }

        if (opts.json) {
          console.log(JSON.stringify(payload));
        } else {
          const event = payload.event || '(no event field)';
          const paint = colorFor(event, payload);
          const time = new Date().toTimeString().slice(0, 8);
          const bits = [
            dim(time),
            paint(bold(event)),
            payload.bot_event && payload.bot_event !== event ? paint(`(${payload.bot_event})`) : '',
            payload.bot_status ? `status=${payload.bot_status}` : '',
            payload.status_code !== undefined ? `code=${payload.status_code}` : '',
            payload.bot_id ? dim(String(payload.bot_id).slice(0, 8)) : '',
          ].filter(Boolean);
          console.log(bits.join('  '));
          if (payload.message) console.log(dim(`         ${payload.message}`));
          if (event === 'transcription.processed' && payload.bot_id) {
            console.log(dim(`         → meetstream transcript ${payload.bot_id}`));
          }
          if (event === 'bot.stopped' && ABNORMAL_STOP.has(stopReason(payload))) {
            console.log(red(`         bot ended abnormally (${stopReason(payload)}, bot_status=${payload.bot_status})`));
          }
        }

        if (opts.forward) {
          fetch(opts.forward, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw })
            .catch((e) => console.error(dim(`  forward failed: ${e.message}`)));
        }
      });

      server.listen(port, () => {
        console.log(`${green('▶')} listening on ${bold(`http://localhost:${port}${opts.path === '/webhook' ? '/webhook' : opts.path}`)}`);
        console.log(dim('  expose it:  ngrok http ' + port));
        console.log(dim('  then create a bot with:  --callback https://<your-ngrok>.ngrok.io/webhook'));
        console.log(dim('  terminals arrive as bot.stopped; the reason is in bot_event · Ctrl-C to stop\n'));
      });
    });
}
