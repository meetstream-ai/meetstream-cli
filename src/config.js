// Config resolution: MEETSTREAM_API_KEY env var wins, else ~/.meetstream/config.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.meetstream');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export const BASE_URL = process.env.MEETSTREAM_API_URL || 'https://api.meetstream.ai/api/v1';

export function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  return CONFIG_PATH;
}

export function resolveApiKey({ required = true } = {}) {
  const key = process.env.MEETSTREAM_API_KEY || loadConfig().api_key;
  if (!key && required) {
    const err = new Error(
      'No API key found. Set MEETSTREAM_API_KEY or run: meetstream auth set-key <key>\n' +
      'Create a key at https://app.meetstream.ai/api-keys'
    );
    err.exitCode = 2;
    throw err;
  }
  return key;
}

export { CONFIG_PATH };
