import { execFileSync } from 'node:child_process';

/**
 * Scopes the lab server's inbound rule to the lab subnet only (design doc
 * §2.4/§2.8) — this box has no business accepting connections from
 * anywhere else on an air-gapped deployment, and a station-side install
 * needs no inbound rule at all beyond what Windows' own outbound-by-default
 * posture already allows for its own control-socket/LiveKit connections.
 */
export function addLabSubnetFirewallRule(params: { ruleName: string; localPort: number; subnetCidr: string }): void {
  execFileSync(
    'netsh.exe',
    [
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name=${params.ruleName}`,
      'dir=in',
      'action=allow',
      'protocol=TCP',
      `localport=${params.localPort}`,
      `remoteip=${params.subnetCidr}`,
    ],
    { stdio: 'inherit' },
  );
}
