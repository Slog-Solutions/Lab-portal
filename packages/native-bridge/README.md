# @lab/native-bridge

Win32 input-lock and remote-control-replay native addon for the student
Electron client. **Not yet implemented** — see `src/types.ts` for the
contract and the build plan's "week one spike" for why this is a
deliberate stub, not an oversight:

1. Does `BlockInput` require elevation on the actual Windows 11 Pro lab
   image? Undocumented by MSDN; must be tested empirically.
2. Can a normal-integrity `WH_KEYBOARD_LL`/`WH_MOUSE_LL` hook suppress
   input destined for an elevated window (UIPI)? Uncertain.
3. Does the hook survive `LowLevelHooksTimeout` under real load, or does
   Windows silently remove it?

Until those are answered, `loadNativeBridge()` returns
`NotImplementedNativeBridge` — every method logs a warning and does
nothing, so `apps/desktop` can be built and typechecked against the real
interface today without blocking on a native build toolchain.

## When the spike is done

1. Scaffold `src/addon.cc` / `src/hooks.cc` / `src/sendinput.cc` with
   node-addon-api + cmake-js (design doc §3.4 — same toolchain
   `@nut-tree-fork/nut-js`'s prebuilds use, so this stays N-API-portable
   between Node 24 and Electron 44 without per-target rebuilds).
2. Commit the compiled binary to `prebuilds/win32-x64/lab_native.node` —
   intentionally **not** gitignored (see root `.gitignore`'s exception for
   this package) so the offline install story (build plan "no `npm
   install` ever runs on site") holds: the binary ships with the repo,
   nothing is compiled at deploy time.
3. `loadNativeBridge()` already resolves that path first and only falls
   back to the stub if it's missing — no caller-side changes needed.
