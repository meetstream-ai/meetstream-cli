import { printJson, dim, ok, transcriptToText, handleError } from '../output.js';

export function registerTranscriptCommands(program, getClient) {
  program
    .command('transcript')
    .description('Fetch a bot\'s transcript (resolves transcript_id for you; --wait polls until ready)')
    .argument('<bot-id>')
    .option('-w, --wait', 'poll until the transcript is ready')
    .option('--timeout <seconds>', 'max wait time with --wait', '600')
    .option('--raw', 'raw provider output instead of processed segments')
    .option('--json', 'JSON segments (default is readable "Speaker: text" lines)')
    .action(async (botId, opts) => {
      try {
        const { transcript_id, transcript } = await getClient().getTranscript(botId, {
          raw: Boolean(opts.raw),
          wait: Boolean(opts.wait),
          timeoutMs: Number(opts.timeout) * 1000,
        });
        if (transcript == null) {
          console.log(dim(`Transcript not ready yet (transcript_id: ${transcript_id ?? 'unresolved'}).`));
          console.log(dim(`Try: meetstream transcript ${botId} --wait`));
          process.exit(3);
        }
        if (opts.json || opts.raw) return printJson(transcript);
        process.stdout.write(transcriptToText(transcript) + '\n');
      } catch (e) { handleError(e, opts); }
    });

  program
    .command('transcriptions')
    .description('List all transcription runs for a bot (ids, status, download URLs)')
    .argument('<bot-id>')
    .action(async (botId, opts) => {
      try {
        const { data } = await getClient().transcriptions(botId);
        printJson(data);
      } catch (e) { handleError(e, opts); }
    });

  program
    .command('transcribe')
    .description('Run (or re-run) transcription on a bot\'s recorded audio')
    .argument('<bot-id>')
    .option('-p, --provider <name>', 'deepgram | assemblyai | sarvam | meetstream | jigsawstack', 'deepgram')
    .option('-l, --language <lang>', 'language (provider-specific format)')
    .option('-c, --callback <url>', 'webhook to notify when done')
    .option('--json', 'JSON output')
    .action(async (botId, opts) => {
      try {
        const p = opts.provider;
        const provider = {};
        if (p === 'deepgram') provider.deepgram = { model: 'nova-3', language: opts.language || 'en' };
        else if (p === 'assemblyai') provider.assemblyai = { speech_models: ['best'], language_code: opts.language || 'en_us' };
        else if (p === 'sarvam') provider.sarvam = { model: 'saarika:v2', language_code: opts.language || 'en-IN', mode: 'batch' };
        else if (p === 'meetstream') provider.meetstream = { language: opts.language || 'auto', translate: false };
        else if (p === 'jigsawstack') provider.jigsawstack = { language: opts.language || 'auto', translate: false };
        else provider[p] = {};
        const { data } = await getClient().transcribe(botId, provider, opts.callback);
        if (opts.json) return printJson(data);
        ok('Transcription started');
        printJson(data);
      } catch (e) { handleError(e, opts); }
    });
}
