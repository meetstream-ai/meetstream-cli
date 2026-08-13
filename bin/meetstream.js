#!/usr/bin/env node
// MeetStream CLI — https://github.com/meetstream-ai/meetstream-cli
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { MeetStreamClient } from '../src/api.js';
import { resolveApiKey } from '../src/config.js';
import { fail } from '../src/output.js';
import { registerBotCommands } from '../src/commands/bot.js';
import { registerTranscriptCommands } from '../src/commands/transcript.js';
import { registerAuthCommands, registerCalendarCommands, registerMiaCommands } from '../src/commands/misc.js';
import { registerListenCommand } from '../src/commands/listen.js';
import { track, shutdownTelemetry } from '../src/telemetry.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();
program
  .name('meetstream')
  .description('MeetStream — meeting bot API from your terminal (Zoom, Google Meet, Teams)\nDocs: https://docs.meetstream.ai · Keys: https://app.meetstream.ai/api-keys')
  .version(version);

let client;
function getClient() {
  if (!client) client = new MeetStreamClient(resolveApiKey());
  return client;
}

registerAuthCommands(program, getClient);
registerBotCommands(program, getClient);
registerTranscriptCommands(program, getClient);
registerCalendarCommands(program, getClient);
registerMiaCommands(program, getClient);
registerListenCommand(program);

program.hook('preAction', (thisCmd, actionCmd) => {
  track('cli_command_run', { command: actionCmd.name(), version });
});

program.parseAsync(process.argv)
  .then(() => shutdownTelemetry())
  .catch(async (err) => {
    await shutdownTelemetry();
    fail(err.message);
    process.exit(err.exitCode || 1);
  });
