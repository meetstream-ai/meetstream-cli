// `meetstream logins teams|google ...` - manage the accounts signed-in bots use.
// Teams accounts use an email + password (write-only). Google accounts use an SSO
// private key + certificate (PEM files). Secrets are never CLI args and never printed.
import { readFileSync } from 'node:fs';
import { printJson, ok, kv, bold, dim, cyan, green, yellow, handleError } from '../output.js';
import { resolvePassword, confirm, PASSWORD_ENV } from '../secrets.js';

function usageError(message) {
  return Object.assign(new Error(message), { exitCode: 2 });
}

async function confirmOrAbort(question, opts) {
  if (opts.yes) return;
  if (!process.stdin.isTTY) throw usageError(`${question} Refusing without --yes in a non-interactive shell.`);
  if (!(await confirm(question))) throw Object.assign(new Error('Aborted'), { exitCode: 1 });
}

function readPem(path, flag) {
  try { return readFileSync(path, 'utf8'); } catch (e) {
    throw usageError(`${flag}: cannot read ${path} (${e.code || e.message})`);
  }
}

const activeLabel = (v) => (v === false ? yellow('inactive') : green('active'));

const PLATFORMS = {
  teams: {
    label: 'Microsoft Teams',
    docs: 'https://docs.meetstream.ai/guides/app-integrations/teams-signed-in-bots',
    domainKey: 'domain',
    m: {
      domains: 'teamsDomainsList', domain: 'teamsDomainGet', addDomain: 'teamsDomainCreate',
      updateDomain: 'teamsDomainUpdate', removeDomain: 'teamsDomainDelete',
      list: 'teamsLoginsList', add: 'teamsLoginCreate', update: 'teamsLoginUpdate', remove: 'teamsLoginDelete',
    },
    loginLine: (l) => `${cyan(l.login_id)}  ${l.email}  ${activeLabel(l.is_active)}  ${dim(`lease: ${l.lease_status ?? '-'}  last: ${l.last_session_result ?? '-'}`)}`,
  },
  google: {
    label: 'Google Meet',
    docs: 'https://docs.meetstream.ai/guides/app-integrations/google-signed-in-bots',
    domainKey: 'sso_workspace_domain',
    m: {
      domains: 'googleDomainsList', domain: 'googleDomainGet', addDomain: 'googleDomainCreate',
      updateDomain: 'googleDomainUpdate', removeDomain: 'googleDomainDelete',
      list: 'googleLoginsList', add: 'googleLoginCreate', update: 'googleLoginUpdate', remove: 'googleLoginDelete',
    },
    loginLine: (l) => `${cyan(l.login_id)}  ${l.email}  ${activeLabel(l.is_active)}  ${dim(`sessions: ${l.active_sessions ?? 0}  last test: ${l.last_test_status ?? '-'}`)}`,
  },
};

function registerPlatform(logins, key, getClient) {
  const p = PLATFORMS[key];
  const isTeams = key === 'teams';
  const cmd = logins
    .command(key)
    .description(`${p.label} signed-in bot domains and accounts (guide: ${p.docs})`);

  // ── Domains ──────────────────────────────────────────────────────────
  cmd
    .command('domains')
    .description('List registered login domains')
    .option('--json', 'JSON output')
    .action(async (opts) => {
      try {
        const { data } = await getClient()[p.m.domains]();
        if (opts.json) return printJson(data);
        const domains = data?.domains || [];
        if (!domains.length) return console.log(dim(`No ${p.label} login domains yet. Register one: meetstream logins ${key} add-domain <domain>`));
        for (const d of domains) {
          const extra = isTeams ? '' : `  ${dim(`max/login: ${d.max_concurrent_per_login ?? '-'}`)}`;
          console.log(`${cyan(d[p.domainKey])}  ${d.name ?? ''}  ${dim(d.login_mode ?? '')}  ${d.active_login_count ?? 0}/${d.login_count ?? 0} active logins${extra}`);
        }
      } catch (e) { handleError(e, opts); }
    });

  cmd
    .command('domain')
    .description('Show one domain and its accounts')
    .argument('<domain>')
    .option('--json', 'JSON output')
    .action(async (domain, opts) => {
      try {
        const { data } = await getClient()[p.m.domain](domain);
        if (opts.json) return printJson(data);
        kv({ domain: bold(data?.[p.domainKey] ?? domain), name: data?.name, login_mode: data?.login_mode, max_concurrent_per_login: data?.max_concurrent_per_login, created_at: data?.created_at });
        const list = data?.logins || [];
        console.log(list.length ? '' : dim('\n  No accounts yet.'));
        for (const l of list) console.log(`  ${p.loginLine(l)}`);
      } catch (e) { handleError(e, opts); }
    });

  const addDomain = cmd
    .command('add-domain')
    .description(isTeams
      ? 'Register a Microsoft 365 bot tenant domain (login_mode is always "always" for Teams)'
      : 'Register a Google Workspace domain (set up SSO in Google Admin first, see the guide)')
    .argument('<domain>')
    .option('--name <name>', 'friendly name');
  if (!isTeams) addDomain.option('--login-mode <mode>', 'always | if_required', 'always');
  addDomain
    .option('--json', 'JSON output')
    .action(async (domain, opts) => {
      try {
        const { data } = await getClient()[p.m.addDomain]({ domain, name: opts.name, loginMode: opts.loginMode });
        if (opts.json) return printJson(data);
        ok(`Domain ${bold(domain)} registered`);
        console.log(dim(isTeams
          ? `\n  Next: meetstream logins teams add --domain ${domain} --email <bot@${domain}>`
          : `\n  Next: meetstream logins google add --domain ${domain} --email <bot@${domain}> --key key.pem --cert cert.pem`));
      } catch (e) { handleError(e, opts); }
    });

  const updateDomain = cmd
    .command('update-domain')
    .description('Rename a domain' + (isTeams ? '' : ' or change its login mode'))
    .argument('<domain>')
    .option('--name <name>', 'new friendly name');
  if (!isTeams) updateDomain.option('--login-mode <mode>', 'always | if_required');
  updateDomain
    .option('--json', 'JSON output')
    .action(async (domain, opts) => {
      try {
        if (!opts.name && !opts.loginMode) throw usageError('Nothing to update: pass --name' + (isTeams ? '' : ' and/or --login-mode'));
        const { data } = await getClient()[p.m.updateDomain](domain, { name: opts.name, loginMode: opts.loginMode });
        if (opts.json) return printJson(data);
        ok(`Domain ${bold(domain)} updated`);
      } catch (e) { handleError(e, opts); }
    });

  cmd
    .command('remove-domain')
    .description(isTeams
      ? 'Delete a domain AND all of its accounts'
      : 'Delete a domain and its accounts (the API refuses while any account is active; disable them first)')
    .argument('<domain>')
    .option('--yes', 'skip confirmation')
    .option('--json', 'JSON output')
    .action(async (domain, opts) => {
      try {
        await confirmOrAbort(`Delete ${p.label} domain ${domain} and every account registered under it?`, opts);
        const { data } = await getClient()[p.m.removeDomain](domain);
        if (opts.json) return printJson(data);
        ok(`Domain ${bold(domain)} deleted`);
      } catch (e) { handleError(e, opts); }
    });

  // ── Accounts ─────────────────────────────────────────────────────────
  cmd
    .command('list')
    .description('List accounts in a domain')
    .requiredOption('--domain <domain>', 'registered domain')
    .option('--json', 'JSON output')
    .action(async (opts) => {
      try {
        const { data } = await getClient()[p.m.list](opts.domain);
        if (opts.json) return printJson(data);
        const list = data?.logins || [];
        if (!list.length) return console.log(dim(`No accounts in ${opts.domain} yet.`));
        for (const l of list) console.log(p.loginLine(l));
      } catch (e) { handleError(e, opts); }
    });

  if (isTeams) {
    cmd
      .command('get')
      .description('Show one account')
      .argument('<login-id>')
      .option('--json', 'JSON output')
      .action(async (loginId, opts) => {
        try {
          const { data } = await getClient().teamsLoginGet(loginId);
          if (opts.json) return printJson(data);
          kv({ login_id: bold(data.login_id), domain: data.domain, email: data.email, is_active: String(data.is_active), lease_status: data.lease_status, last_session_result: data.last_session_result, last_login_error: data.last_login_error, updated_at: data.updated_at });
        } catch (e) { handleError(e, opts); }
      });

    cmd
      .command('add')
      .description(`Register a bot account. Password from --password-stdin, $${PASSWORD_ENV}, or a hidden prompt (never a CLI argument)`)
      .requiredOption('--domain <domain>', 'registered domain')
      .requiredOption('--email <email>', 'account email, e.g. bot1@bots.example.com')
      .option('--password-stdin', 'read the password from stdin')
      .option('--inactive', 'register the account disabled')
      .option('--json', 'JSON output')
      .action(async (opts) => {
        try {
          const password = await resolvePassword({ passwordStdin: opts.passwordStdin });
          const { data } = await getClient().teamsLoginCreate({ domain: opts.domain, email: opts.email, password, isActive: opts.inactive ? false : undefined });
          if (opts.json) return printJson(data);
          ok(`Account ${bold(opts.email)} registered (login_id ${cyan(data?.login_id)})`);
          console.log(dim('  Teams allows ONE concurrent bot per account: register N accounts for N concurrent signed-in bots.'));
        } catch (e) { handleError(e, opts); }
      });

    cmd
      .command('set-password')
      .description(`Rotate an account password (also reactivates a deactivated account). Same password sources as add`)
      .argument('<login-id>')
      .option('--password-stdin', 'read the password from stdin')
      .option('--json', 'JSON output')
      .action(async (loginId, opts) => {
        try {
          const password = await resolvePassword({ passwordStdin: opts.passwordStdin });
          const { data } = await getClient().teamsLoginUpdate(loginId, { password });
          if (opts.json) return printJson(data);
          ok(`Password updated for ${bold(loginId)}`);
        } catch (e) { handleError(e, opts); }
      });
  } else {
    cmd
      .command('add')
      .description('Register a Google Workspace account with the SSO key + certificate from the setup guide')
      .requiredOption('--domain <domain>', 'registered Workspace domain')
      .requiredOption('--email <email>', 'account email')
      .requiredOption('--key <path>', 'path to the SSO private key PEM (key.pem)')
      .requiredOption('--cert <path>', 'path to the SSO certificate PEM (cert.pem)')
      .option('--inactive', 'register the account disabled')
      .option('--json', 'JSON output')
      .action(async (opts) => {
        try {
          const privateKeyPem = readPem(opts.key, '--key');
          const certPem = readPem(opts.cert, '--cert');
          const { data } = await getClient().googleLoginCreate({ domain: opts.domain, email: opts.email, privateKeyPem, certPem, isActive: opts.inactive ? false : undefined });
          if (opts.json) return printJson(data);
          ok(`Account ${bold(opts.email)} registered (login_id ${cyan(data?.login_id)})`);
        } catch (e) { handleError(e, opts); }
      });

    cmd
      .command('set-cert')
      .description('Replace an account\'s SSO key + certificate (refused while the account has active sessions)')
      .argument('<login-id>')
      .requiredOption('--domain <domain>', 'the account\'s domain')
      .requiredOption('--key <path>', 'path to the SSO private key PEM')
      .requiredOption('--cert <path>', 'path to the SSO certificate PEM')
      .option('--json', 'JSON output')
      .action(async (loginId, opts) => {
        try {
          const { data } = await getClient().googleLoginUpdate(loginId, {
            domain: opts.domain, privateKeyPem: readPem(opts.key, '--key'), certPem: readPem(opts.cert, '--cert'),
          });
          if (opts.json) return printJson(data);
          ok(`Credentials updated for ${bold(loginId)}`);
        } catch (e) { handleError(e, opts); }
      });
  }

  for (const [name, active] of [['disable', false], ['enable', true]]) {
    const c = cmd
      .command(name)
      .description(active ? 'Re-enable an account' : 'Disable an account (bots stop using it)')
      .argument('<login-id>');
    if (!isTeams) c.requiredOption('--domain <domain>', 'the account\'s domain');
    c.option('--json', 'JSON output')
      .action(async (loginId, opts) => {
        try {
          const { data } = await getClient()[p.m.update](loginId, isTeams ? { isActive: active } : { domain: opts.domain, isActive: active });
          if (opts.json) return printJson(data);
          ok(`Account ${bold(loginId)} ${active ? 'enabled' : 'disabled'}`);
        } catch (e) { handleError(e, opts); }
      });
  }

  const rm = cmd
    .command('remove')
    .description('Delete an account')
    .argument('<login-id>');
  if (!isTeams) rm.requiredOption('--domain <domain>', 'the account\'s domain');
  rm.option('--yes', 'skip confirmation')
    .option('--json', 'JSON output')
    .action(async (loginId, opts) => {
      try {
        await confirmOrAbort(`Delete ${p.label} account ${loginId}?`, opts);
        const { data } = isTeams
          ? await getClient().teamsLoginDelete(loginId)
          : await getClient().googleLoginDelete(loginId, opts.domain);
        if (opts.json) return printJson(data);
        ok(`Account ${bold(loginId)} deleted`);
      } catch (e) { handleError(e, opts); }
    });

  return cmd;
}

export function registerLoginsCommands(program, getClient) {
  const logins = program
    .command('logins')
    .description('Accounts for signed-in bots (Microsoft Teams, Google Meet). Use them with bot create --teams-login-domain / --google-login-domain');
  registerPlatform(logins, 'teams', getClient);
  registerPlatform(logins, 'google', getClient);
  return logins;
}
