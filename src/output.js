// Terminal output helpers - zero-dependency colors + consistent JSON mode.
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
/** Warning on stderr, so --json output on stdout stays parseable. */
export function warnErr(msg) { console.error(yellow('⚠ ') + msg); }
export function fail(msg) { console.error(red('✗ ') + msg); }

export function kv(pairs) {
  const width = Math.max(...Object.keys(pairs).map((k) => k.length));
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined || v === null || v === '') continue;
    console.log(`  ${dim(k.padEnd(width))}  ${v}`);
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** Speaker of a transcript segment: participant.name, else the flat speaker field. */
export function segmentSpeaker(s) {
  return str(s?.participant?.name) || str(s?.speaker) || 'Unknown';
}

/** Text of a transcript segment: words[].text joined with spaces, else the flat transcript field. */
export function segmentText(s) {
  if (Array.isArray(s?.words)) {
    const parts = s.words.map((w) => str(w?.text ?? w?.punctuated_word ?? w?.word)).filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  return str(s?.transcript) || str(s?.text);
}

/**
 * Render transcript segments as readable "Speaker: text" lines. Segments name the speaker in
 * participant.name and hold the text in words[].text; the flat speaker/transcript shape also works.
 * Segments with no text are skipped.
 */
export function transcriptToText(segments) {
  if (!Array.isArray(segments)) return typeof segments === 'string' ? segments : JSON.stringify(segments, null, 2);
  return segments
    .map((s) => {
      const text = segmentText(s);
      return text ? `${segmentSpeaker(s)}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

const FAILED_TRANSCRIPT_EXIT = 4;

/** For a failed transcript (422 with transcript_status): { reason, transcript_status, transcript_id }, else null. */
export function failedTranscript(err) {
  if (err?.status !== 422 || typeof err?.body?.transcript_status !== 'string') return null;
  const msg = typeof err.body.message === 'string' ? err.body.message : '';
  return {
    reason: msg.replace(/^Transcript processing failed:?\s*/i, '') || msg || 'no reason given',
    transcript_status: err.body.transcript_status,
    transcript_id: err.body.transcript_id,
  };
}

export function handleError(err, { json = false } = {}) {
  const failed = failedTranscript(err);
  if (failed) {
    if (json) {
      printJson({ error: 'transcript_failed', status: 422, ...failed });
    } else {
      fail(`Transcript failed: ${failed.reason}`);
      console.error(dim(`  transcript_id ${failed.transcript_id ?? '(unknown)'}, status ${failed.transcript_status}. It will not become ready, so do not retry.`));
      console.error(dim('  Fix the cause (for example the provider API key or its usage limit), then run: meetstream transcribe <bot-id>'));
    }
    process.exit(FAILED_TRANSCRIPT_EXIT);
  }
  if (json) {
    printJson({ error: err.message, status: err.status, body: err.body, ...(err.retryAfter !== undefined ? { retry_after: err.retryAfter } : {}) });
  } else {
    fail(err.message);
    if (/MeetStream-managed keys are not available/i.test(err.message || '')) {
      console.error(dim('  MeetStream\'s inbuilt keys are not on for your account yet. Use your own provider key for that section'));
      console.error(dim('  ("key_source": "user", key saved under Integrations), then run the command again.'));
    }
    if (err.status === 401) console.error(dim('  Check your API key: https://app.meetstream.ai/api-keys'));
    if (err.status === 429 && err.retryAfter !== undefined) {
      console.error(dim(`  Rate limited. Wait ${err.retryAfter} s, then run the command again (reuse the same --idempotency-key).`));
    }
  }
  process.exit(err.exitCode || 1);
}
