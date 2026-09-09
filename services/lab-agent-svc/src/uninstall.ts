import { buildService } from './service.js';

/** Stops and removes the LabAgentSvc Windows service. Deliberately does
 * NOT revert the GPO policy values or the imported root CA — an admin
 * decommissioning one station intentionally, not un-hardening the rest
 * of the lab, is the only real caller of this script. */
function main(): void {
  if (process.platform !== 'win32') {
    throw new Error('lab-agent-svc only runs on Windows');
  }
  const service = buildService();
  service.on('uninstall', () => console.log('[lab-agent-svc] service uninstalled'));
  service.uninstall();
}

main();
