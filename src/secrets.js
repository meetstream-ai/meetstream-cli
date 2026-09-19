// Secret input for signed-in bot accounts. A password is NEVER accepted as a CLI
// argument (it would land in shell history and `ps`), and is never printed or logged.
import readline from 'node:readline';
import { Writable } from 'node:stream';

export const PASSWORD_ENV = 'MEETSTREAM_LOGIN_PASSWORD';

function usageError(message) {
  return Object.assign(new Error(message), { exitCode: 2 });
}

/** Read all of stdin and strip one trailing newline (so `echo "$PW" | ...` works). */
export async function readStdin(stream = process.stdin) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

/** Prompt on stderr without echoing what is typed. */
export function promptHidden(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    let muted = false;
    const sink = new Writable({
      write(chunk, encoding, cb) { if (!muted) output.write(chunk, encoding); cb(); },
    });
    const rl = readline.createInterface({ input, output: sink, terminal: true });
    rl.on('SIGINT', () => { rl.close(); output.write('\n'); reject(usageError('Cancelled')); });
    rl.question(question, (answer) => { rl.close(); output.write('\n'); resolve(answer); });
    muted = true;
  });
}

/** Ask a yes/no question on stderr. Resolves true only for y / yes. */
export function confirm(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    rl.question(`${question} [y/N] `, (answer) => { rl.close(); resolve(/^y(es)?$/i.test(answer.trim())); });
  });
}

/**
 * Resolve a login password. Order: --password-stdin, then $MEETSTREAM_LOGIN_PASSWORD,
 * then an interactive hidden prompt (TTY only). Dependencies are injectable for tests.
 */
export async function resolvePassword({
  passwordStdin = false,
  env = process.env,
  isTTY = Boolean(process.stdin.isTTY),
  read = readStdin,
  prompt = promptHidden,
} = {}) {
  let password;
  if (passwordStdin) password = await read();
  else if (env[PASSWORD_ENV]) password = env[PASSWORD_ENV];
  else if (isTTY) password = await prompt('Account password (input hidden): ');
  else {
    throw usageError(`No password provided. Pipe it with --password-stdin or set ${PASSWORD_ENV}. Passwords are never accepted as command-line arguments.`);
  }
  if (!password) throw usageError('Password is empty.');
  return password;
}
