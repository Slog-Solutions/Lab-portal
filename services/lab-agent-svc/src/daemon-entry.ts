// The actual process node-windows spawns as LabAgentSvc (see service.ts) —
// built to dist/daemon-entry.cjs by `npm run build`, since node-windows
// invokes `node <script>` directly and cannot run a .ts file itself.
import { runDaemon } from './daemon.js';

runDaemon();
