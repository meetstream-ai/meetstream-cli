// `meetstream listen` — local webhook receiver for MeetStream lifecycle events.
// Ground truth (live-verified): the envelope key is `event` (NOT bot_event).
// Two-layer model: bot.stopped fires once; bot_status says why
// (Stopped | NotAllowed lobby-timeout | Denied host-denied | Error crash).
import { createServer } from 'node:http';
import { bold, dim, green, yellow, red, cyan } from '../output.js';

const TERMINAL = new Set(['bot.stopped', 'bot.done']);
const FAILY = /denied|notallowed|failed|error/i;

function colorFor(event, payload) {
  if (event === 'transcription.failed' || FAILY.test(payload?.bot_status || '')) return red;
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
            payload.bot_status ? `status=${payload.bot_status}` : '',
            payload.status_code !== undefined ? `code=${payload.status_code}` : '',
            payload.bot_id ? dim(String(payload.bot_id).slice(0, 8)) : '',
          ].filter(Boolean);
          console.log(bits.join('  '));
          if (payload.message) console.log(dim(`         ${payload.message}`));
          if (event === 'transcription.processed' && payload.bot_id) {
            console.log(dim(`         → meetstream transcript ${payload.bot_id}`));
          }
          if (event === 'bot.stopped' && FAILY.test(payload.bot_status || '')) {
            console.log(red(`         bot ended abnormally (bot_status=${payload.bot_status})`));
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
        console.log(dim('  events arrive under the `event` key · Ctrl-C to stop\n'));
      });
    });
}
