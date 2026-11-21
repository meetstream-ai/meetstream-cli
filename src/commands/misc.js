import { readFileSync } from 'node:fs';
import { printJson, ok, kv, dim, warn, handleError } from '../output.js';
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

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw Object.assign(new Error(`Could not read JSON from ${path}: ${e.message}`), { exitCode: 2 });
  }
}

export function registerMiaCommands(program, getClient) {
  const mia = program
    .command('mia')
    .alias('agents')
    .description('Agents API: voice agent (MIA) configs. Attach one to a bot with: bot create <link> --agent-config <id>');

  mia.command('list').description('List agent configs').option('--json', 'JSON output').action(async (opts) => {
    try { printJson((await getClient().miaList()).data); } catch (e) { handleError(e, opts); }
  });

  mia.command('get').description('Show one agent config (secrets come back masked)').argument('<agent-config-id>')
    .option('--json', 'JSON output')
    .action(async (id, opts) => {
      try { printJson((await getClient().miaGet(id)).data); } catch (e) { handleError(e, opts); }
    });

  mia
    .command('create')
    .description('Create an agent config from a JSON file (agent_name, mode, model, voice, transcriber, agent, ...)')
    .requiredOption('-f, --file <path>', 'JSON config file')
    .option('--json', 'JSON output')
    .action(async (opts) => {
      try {
        const { data } = await getClient().miaCreate(readJsonFile(opts.file));
        if (opts.json) return printJson(data);
        ok('Agent config created'); printJson(data);
        const id = data?.agent_config_id || '<agent-config-id>';
        console.log(dim(`Attach it to a bot (nothing else is needed): meetstream bot create <meeting-link> --agent-config ${id}`));
      } catch (e) { handleError(e, opts); }
    });

  mia
    .command('update')
    .description('Update an agent config from a JSON file (PUT: each block you send replaces the saved block, so send whole blocks)')
    .argument('<agent-config-id>')
    .requiredOption('-f, --file <path>', 'JSON file with the blocks to replace')
    .option('--json', 'JSON output')
    .action(async (id, opts) => {
      try {
        const body = { ...readJsonFile(opts.file), agent_config_id: id };
        const { data } = await getClient().miaUpdate(body);
        if (opts.json) return printJson(data);
        ok('Agent config updated'); printJson(data);
      } catch (e) { handleError(e, opts); }
    });

  mia.command('delete').description('Delete an agent config').argument('<agent-config-id>').option('--json', 'JSON output')
    .action(async (id, opts) => {
      try {
        const { data } = await getClient().miaDelete(id);
        if (opts.json) return printJson(data);
        printJson(data); ok('Deleted');
      } catch (e) { handleError(e, opts); }
    });

  mia
    .command('check')
    .description('Test the connection to your local agent bridge (model.provider "local_agent"; needs the local agent feature on for your account)')
    .argument('<agent-config-id>')
    .option('--json', 'JSON output')
    .action(async (id, opts) => {
      try {
        const { data } = await getClient().miaCheckLocalAgent(id);
        if (opts.json) return printJson(data);
        const status = data?.local_agent?.status;
        if (status === 'ok') ok(`Local agent bridge is reachable (${data.local_agent.latency_ms ?? '?'} ms)`);
        else warn(`Local agent bridge status: ${status ?? 'unknown'}`);
        printJson(data);
        if (status && status !== 'ok') process.exit(3);
      } catch (e) { handleError(e, opts); }
    });
}

export function registerBalanceCommand(program, getClient) {
  program
    .command('balance')
    .description('Show your prepaid balance (read only; available when the balance endpoint is on for your account)')
    .option('--json', 'JSON output')
    .action(async (opts) => {
      try {
        const { data } = await getClient().balance();
        if (opts.json) return printJson(data);
        if (data?.balance_usd == null) {
          kv({ customer_type: data?.customer_type, balance: 'no prepaid balance (billed by invoice)' });
        } else {
          kv({ customer_type: data?.customer_type, balance: `${data.balance_usd} ${data.currency || 'USD'}` });
        }
        console.log(dim('  Top up: https://app.meetstream.ai/billing'));
      } catch (e) {
        if (e.status === 404) {
          const msg = 'The balance endpoint is not available for this account yet. See your balance at https://app.meetstream.ai/billing';
          if (opts.json) printJson({ error: 'balance_unavailable', status: 404, message: msg, billing_url: 'https://app.meetstream.ai/billing' });
          else warn(msg);
          process.exit(3);
        }
        handleError(e, opts);
      }
    });
}
