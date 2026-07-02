import { readFileSync } from 'node:fs';
import { printJson, ok, kv, dim, handleError } from '../output.js';
import { saveConfig, resolveApiKey, CONFIG_PATH, BASE_URL } from '../config.js';

export function registerAuthCommands(program, getClient) {
  const auth = program.command('auth').description('Manage your API key');

  auth
    .command('set-key')
    .description(`Store your API key in ${CONFIG_PATH}`)
    .argument('<api-key>')
    .action((key) => {
      const path = saveConfig({ api_key: key });
      ok(`API key saved to ${path} (env MEETSTREAM_API_KEY still takes precedence)`);
    });

  auth
    .command('status')
    .description('Validate the configured key against the live API')
    .action(async (opts) => {
      try {
        const key = resolveApiKey();
        const { data } = await getClient().listBots();
        ok('API key is valid');
        kv({ key: key.slice(0, 6) + '…' + key.slice(-4), base_url: BASE_URL, bots_on_account: (data?.bots || []).length + (data?.hasNextPage ? '+' : '') });
      } catch (e) { handleError(e, opts); }
    });
}

export function registerCalendarCommands(program, getClient) {
  const cal = program.command('calendar').description('Google Calendar auto-join');

  cal
    .command('connect')
    .description('Connect a Google Calendar (OAuth refresh-token flow)')
    .requiredOption('--client-id <id>', 'Google OAuth client id')
    .requiredOption('--client-secret <secret>', 'Google OAuth client secret')
    .requiredOption('--refresh-token <token>', 'Google OAuth refresh token')
    .action(async (opts) => {
      try {
        const { data } = await getClient().connectCalendar({ clientId: opts.clientId, clientSecret: opts.clientSecret, refreshToken: opts.refreshToken });
        ok('Calendar connected'); printJson(data);
      } catch (e) { handleError(e, opts); }
    });

  cal.command('list').description('List connected calendars').action(async (opts) => {
    try { printJson((await getClient().listCalendars()).data); } catch (e) { handleError(e, opts); }
  });
  cal.command('events').description('Fetch/sync upcoming events').action(async (opts) => {
    try { printJson((await getClient().calendarEvents()).data); } catch (e) { handleError(e, opts); }
  });
  cal.command('schedule').description('Schedule a bot for a calendar event').argument('<event-id>').action(async (id, opts) => {
    try { printJson((await getClient().scheduleEvent(id)).data); } catch (e) { handleError(e, opts); }
  });
  cal.command('unschedule').description('Remove the scheduled bot for an event').argument('<event-id>').action(async (id, opts) => {
    try { printJson((await getClient().unscheduleEvent(id)).data); } catch (e) { handleError(e, opts); }
  });
  cal
    .command('auto-join')
    .description('Enable/disable auto-join for every calendar meeting')
    .argument('<on|off>')
    .option('-n, --name <bot-name>', 'default bot name', 'Notetaker')
    .option('--video', 'record video')
    .action(async (mode, opts) => {
      try {
        const cfg = { bot_name: opts.name, audio_required: true, video_required: Boolean(opts.video), automatic_leave: { everyone_left_timeout: 60 } };
        const { data } = mode === 'on'
          ? await getClient().autoScheduleEnable(cfg)
          : await getClient().autoScheduleDisable(cfg);
        ok(`Auto-join ${mode === 'on' ? 'enabled' : 'disabled'}`); printJson(data);
      } catch (e) { handleError(e, opts); }
    });
  cal.command('reschedule').description('Change a scheduled bot\'s join time').argument('<bot-id>').argument('<iso8601>').action(async (botId, when, opts) => {
    try { printJson((await getClient().rescheduleBot(botId, when)).data); } catch (e) { handleError(e, opts); }
  });
  cal.command('cancel').description('Delete a scheduled (not yet joined) bot').argument('<bot-id>').action(async (botId, opts) => {
    try { printJson((await getClient().deleteScheduledBot(botId)).data); } catch (e) { handleError(e, opts); }
  });
}

export function registerMiaCommands(program, getClient) {
  const mia = program.command('mia').description('MIA conversational AI agents');
  mia.command('list').description('List agent configs').action(async (opts) => {
    try { printJson((await getClient().miaList()).data); } catch (e) { handleError(e, opts); }
  });
  mia
    .command('create')
    .description('Create an agent config from a JSON file (agent_name, mode, model, voice, transcriber, …)')
    .requiredOption('-f, --file <path>', 'JSON config file')
    .action(async (opts) => {
      try {
        const cfg = JSON.parse(readFileSync(opts.file, 'utf8'));
        const { data } = await getClient().miaCreate(cfg);
        ok('Agent config created'); printJson(data);
        console.log(dim('Attach it to a bot: meetstream bot create <link> --agent-config-id <id> --socket-ws <wss> --live-audio-ws <wss>'));
      } catch (e) { handleError(e, opts); }
    });
  mia.command('delete').description('Delete an agent config').argument('<agent-config-id>').action(async (id, opts) => {
    try { printJson((await getClient().miaDelete(id)).data); ok('Deleted'); } catch (e) { handleError(e, opts); }
  });
}
