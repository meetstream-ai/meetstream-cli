import { buildCreateBotPayload } from '../api.js';
import { printJson, ok, kv, bold, dim, cyan, transcriptToText, handleError } from '../output.js';

function parseAttrs(list = []) {
  const out = {};
  for (const item of list) {
    const i = item.indexOf('=');
    if (i === -1) throw Object.assign(new Error(`--attr expects key=value, got "${item}"`), { exitCode: 2 });
    out[item.slice(0, i)] = item.slice(i + 1); // values kept as strings (API expects strings)
  }
  return out;
}

export function registerBotCommands(program, getClient) {
  const bot = program.command('bot').description('Create and manage meeting bots');

  bot
    .command('create')
    .description('Send a bot to a meeting (or schedule with --join-at)')
    .argument('<meeting-link>', 'Zoom / Google Meet / Teams meeting URL')
    .option('-n, --name <name>', 'bot display name', 'MeetStream Bot')
    .option('--video', 'record video (default: audio only)')
    .option('-t, --transcript <provider>', 'deepgram | assemblyai | sarvam | meetstream | jigsawstack | meeting_captions | deepgram_streaming | assemblyai_streaming')
    .option('-l, --language <lang>', 'transcription language (provider-specific format)')
    .option('-c, --callback <url>', 'HTTPS webhook for lifecycle events')
    .option('--join-at <iso8601>', 'schedule a future join, e.g. 2026-07-02T15:00:00Z')
    .option('--bot-message <msg>', 'chat message posted when the bot joins')
    .option('--image-url <url>', 'PUBLIC image URL for the bot avatar')
    .option('--retention-hours <n>', 'data retention window (default: API default 24h)')
    .option('--separate-audio', 'capture per-participant audio streams')
    .option('--separate-video', 'capture per-participant video streams')
    .option('--zoom-obf', 'use Zoom On-Behalf-Of')
    .option('--agent-config-id <id>', 'attach a MIA conversational agent')
    .option('--live-transcript-webhook <url>', 'webhook URL for live transcript chunks')
    .option('--live-audio-ws <wss>', 'WebSocket URL for live audio out')
    .option('--live-video-ws <wss>', 'WebSocket URL for live video out')
    .option('--socket-ws <wss>', 'two-way bot-control WebSocket (socket_connection_url)')
    .option('--attr <key=value...>', 'custom_attributes entries (echoed back in webhooks)')
    .option('--idempotency-key <uuid>', 'safe-retry key (retry returns HTTP 507 with the original bot)')
    .option('--everyone-left-timeout <sec>', 'leave after everyone else leaves', '60')
    .option('--waiting-room-timeout <sec>', 'max seconds in waiting room', '300')
    .option('--max-recording-seconds <sec>', 'max in-call recording seconds', '14400')
    .option('--json', 'JSON output')
    .action(async (meetingLink, opts) => {
      try {
        const client = getClient();
        const payload = buildCreateBotPayload({
          meetingLink,
          name: opts.name,
          video: opts.video,
          transcript: opts.transcript,
          language: opts.language,
          callback: opts.callback,
          joinAt: opts.joinAt,
          botMessage: opts.botMessage,
          imageUrl: opts.imageUrl,
          retentionHours: opts.retentionHours,
          separateAudio: opts.separateAudio,
          separateVideo: opts.separateVideo,
          zoomObf: opts.zoomObf,
          agentConfigId: opts.agentConfigId,
          liveTranscriptWebhook: opts.liveTranscriptWebhook,
          liveAudioWs: opts.liveAudioWs,
          liveVideoWs: opts.liveVideoWs,
          socketWs: opts.socketWs,
          attrs: parseAttrs(opts.attr),
          everyoneLeftTimeout: opts.everyoneLeftTimeout,
          waitingRoomTimeout: opts.waitingRoomTimeout,
          maxRecordingSeconds: opts.maxRecordingSeconds,
        });
        const { status, data } = await client.createBot(payload, { idempotencyKey: opts.idempotencyKey });
        if (opts.json) return printJson(data);
        ok(status === 507 ? 'Idempotent replay — existing bot returned (no new bot created)' : 'Bot created');
        kv({ bot_id: bold(data.bot_id), transcript_id: data.transcript_id || dim('(pending)'), status: data.status, meeting: data.meeting_url });
        console.log(dim(`\n  Next: meetstream bot status ${data.bot_id} --watch`));
        if (payload.recording_config?.transcript) console.log(dim(`        meetstream transcript ${data.bot_id} --wait`));
      } catch (e) { handleError(e, opts); }
    });

  bot
    .command('list')
    .description('List all bots on the account')
    .option('--json', 'JSON output')
    .action(async (opts) => {
      try {
        const { data } = await getClient().listBots();
        if (opts.json) return printJson(data);
        const bots = data?.bots || [];
        if (!bots.length) return console.log(dim('No bots yet. Create one: meetstream bot create <meeting-link>'));
        for (const b of bots) {
          const id = b.BotID || b.bot_id || b.id;
          const st = b.Status || b.status || '';
          const name = b.BotUsername || b.bot_name || '';
          const plat = b.Platform || '';
          console.log(`${cyan(id)}  ${String(st).padEnd(12)} ${name} ${dim(plat)}`);
        }
        if (data?.hasNextPage) console.log(dim(`… more pages (nextCursor: ${data.nextCursor})`));
      } catch (e) { handleError(e, opts); }
    });

  bot
    .command('status')
    .description('Bot status (Joining → InWaitingRoom → InMeeting → Recording → Stopped)')
    .argument('<bot-id>')
    .option('-w, --watch', 'poll every 5s until a terminal status')
    .option('--json', 'JSON output')
    .action(async (botId, opts) => {
      try {
        const client = getClient();
        for (;;) {
          const { data } = await client.botStatus(botId);
          if (opts.json && !opts.watch) return printJson(data);
          const st = data.status || JSON.stringify(data);
          console.log(`${new Date().toTimeString().slice(0, 8)}  ${bold(st)}`);
          if (!opts.watch || /stopped|done|error|failed|notallowed|denied/i.test(String(st))) break;
          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch (e) { handleError(e, opts); }
    });

  const simpleGets = [
    ['detail', 'botDetail', 'Full session metadata (incl. transcript_id + caption_file)'],
    ['summary', 'botSummary', "MeetStream's built-in AI meeting summary"],
    ['audio', 'botAudio', 'Recorded audio URL (presigned S3, valid 1h)'],
    ['video', 'botVideo', 'Recorded video URL (presigned S3, valid 10min)'],
    ['streams', 'recordingStreams', 'Per-participant video streams (needs --separate-video at create)'],
    ['audio-streams', 'audioStreams', 'Per-participant audio streams (needs --separate-audio at create)'],
    ['timeline', 'speakerTimeline', 'Speaker timeline (who spoke when)'],
    ['chats', 'chats', 'In-meeting chat messages'],
    ['screenshots', 'screenshots', 'Screenshots captured during the meeting'],
    ['participants', 'participants', 'Participant list'],
  ];
  for (const [name, method, desc] of simpleGets) {
    bot
      .command(name)
      .description(desc)
      .argument('<bot-id>')
      .option('--json', 'JSON output')
      .action(async (botId, opts) => {
        try {
          const { data } = await getClient()[method](botId);
          printJson(data); // structured data — JSON is the honest default
        } catch (e) { handleError(e, opts); }
      });
  }

  bot
    .command('remove')
    .description('Remove the bot from an active meeting (data is kept)')
    .argument('<bot-id>')
    .option('--json', 'JSON output')
    .action(async (botId, opts) => {
      try {
        const { data } = await getClient().removeBot(botId);
        if (opts.json) return printJson(data);
        ok(`Bot ${botId} removed from meeting`);
      } catch (e) { handleError(e, opts); }
    });

  bot
    .command('delete')
    .description('PERMANENTLY delete a bot\'s audio, video, and transcripts')
    .argument('<bot-id>')
    .option('--yes', 'skip confirmation')
    .option('--json', 'JSON output')
    .action(async (botId, opts) => {
      try {
        if (!opts.yes) {
          const err = new Error('Refusing to delete without --yes (this permanently removes all media + transcripts)');
          err.exitCode = 2;
          throw err;
        }
        const { data } = await getClient().deleteBotData(botId);
        if (opts.json) return printJson(data);
        ok(`Bot ${botId} data deleted (a data_deletion webhook will fire)`);
      } catch (e) { handleError(e, opts); }
    });

  bot
    .command('send-message')
    .description('Post a chat message into the live meeting')
    .argument('<bot-id>')
    .argument('<message...>')
    .option('--json', 'JSON output')
    .action(async (botId, messageWords, opts) => {
      try {
        const { data } = await getClient().sendMessage(botId, messageWords.join(' '));
        if (opts.json) return printJson(data);
        ok('Message sent');
      } catch (e) { handleError(e, opts); }
    });

  bot
    .command('send-image')
    .description('Show an image/GIF as the bot\'s video frame (public URL)')
    .argument('<bot-id>')
    .argument('<img-url>')
    .option('-d, --duration <seconds>', 'display duration')
    .option('--json', 'JSON output')
    .action(async (botId, imgUrl, opts) => {
      try {
        const { data } = await getClient().sendImage(botId, imgUrl, opts.duration ? Number(opts.duration) : undefined);
        if (opts.json) return printJson(data);
        ok('Image sent');
      } catch (e) { handleError(e, opts); }
    });

  return bot;
}

export { transcriptToText };
