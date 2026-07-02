// Terminal output helpers — zero-dependency colors + consistent JSON mode.
const tty = process.stdout.isTTY;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const bold = c('1');
export const dim = c('2');
export const green = c('32');
export const yellow = c('33');
export const red = c('31');
export const cyan = c('36');

export function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

export function ok(msg) { console.log(green('✓ ') + msg); }
export function warn(msg) { console.log(yellow('⚠ ') + msg); }
export function fail(msg) { console.error(red('✗ ') + msg); }

export function kv(pairs) {
  const width = Math.max(...Object.keys(pairs).map((k) => k.length));
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined || v === null || v === '') continue;
    console.log(`  ${dim(k.padEnd(width))}  ${v}`);
  }
}

/** Render transcript segments (speaker + transcript fields) as readable text. */
export function transcriptToText(segments) {
  if (!Array.isArray(segments)) return typeof segments === 'string' ? segments : JSON.stringify(segments, null, 2);
  return segments
    .map((s) => `${s.speaker ?? 'Unknown'}: ${s.transcript ?? ''}`.trim())
    .filter(Boolean)
    .join('\n');
}

export function handleError(err, { json = false } = {}) {
  if (json) {
    printJson({ error: err.message, status: err.status, body: err.body });
  } else {
    fail(err.message);
    if (err.status === 401) console.error(dim('  Check your API key: https://app.meetstream.ai/api-keys'));
  }
  process.exit(err.exitCode || 1);
}
