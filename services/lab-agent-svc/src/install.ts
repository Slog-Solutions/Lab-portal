import { buildService } from './service.js';
import { applyGpoPolicies } from './gpo-policies.js';
import { importRootCa } from './root-ca.js';
import { addLabSubnetFirewallRule } from './firewall.js';

/**
 * The elevated post-install step `apps/desktop/build/installer.nsh`
 * documents and (as of this pass) still only documents — see that file's
 * own comment. Run manually (`npm run install:elevated --workspace
 * services/lab-agent-svc -- --root-ca <path> --subnet 10.0.0.0/24`) from
 * an Administrator shell on the actual station/server image being
 * imaged, never on a developer's own machine: every step here is a real,
 * mutating elevated action (registry policy writes, a Trusted Root CA
 * import, a firewall rule, a Windows service registration), exactly the
 * kind of "hard to reverse, outward-facing" change this project's own
 * engineering discipline says to keep off a dev box. That is also why
 * this pass's testing stopped at gpo-policies.ts's pure, unexecuted
 * command-construction logic (see its own doc comment) rather than
 * calling this file — the same honesty pattern every prior phase used
 * for a genuinely untestable-here gap (native-bridge's input hooks,
 * pronunciation's unvendored TTS binaries) rather than skipping the
 * problem silently.
 */
async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('lab-agent-svc only runs on Windows (Annexure-III specifies Windows 11 Pro stations/server)');
  }
  const args = parseArgs(process.argv.slice(2));

  console.log('[lab-agent-svc] applying input-lock GPO policy values…');
  applyGpoPolicies();

  if (args.rootCa) {
    console.log(`[lab-agent-svc] importing root CA from ${args.rootCa}…`);
    importRootCa(args.rootCa);
  } else {
    console.warn('[lab-agent-svc] --root-ca not given — skipping Trusted Root import (stations will see TLS warnings)');
  }

  if (args.subnet) {
    console.log(`[lab-agent-svc] adding firewall rule for ${args.subnet}…`);
    addLabSubnetFirewallRule({ ruleName: 'LabPortal LAN', localPort: 443, subnetCidr: args.subnet });
  } else {
    console.warn('[lab-agent-svc] --subnet not given — skipping firewall rule');
  }

  console.log('[lab-agent-svc] registering Windows service…');
  const service = buildService();
  service.on('install', () => {
    console.log('[lab-agent-svc] service installed, starting…');
    service.start();
  });
  service.install();
}

function parseArgs(argv: string[]): { rootCa?: string; subnet?: string } {
  const result: { rootCa?: string; subnet?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root-ca') result.rootCa = argv[++i];
    if (argv[i] === '--subnet') result.subnet = argv[++i];
  }
  return result;
}

main().catch((err) => {
  console.error('[lab-agent-svc] install failed:', err);
  process.exit(1);
});
