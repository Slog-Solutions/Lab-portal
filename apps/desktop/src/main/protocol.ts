import { protocol, net } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_SCHEME = 'app';

/**
 * MUST be called before app.whenReady() — registerSchemesAsPrivileged is
 * only effective if invoked at module load time.
 *
 * Why not file://: it gives an opaque origin — no localStorage, no
 * IndexedDB, and an unreliable secure-context verdict. getUserMedia
 * (screen share, mic — the entire point of this client) requires a
 * secure context (design doc §1.4, §2.8). A privileged custom scheme
 * gives a real origin that Chromium treats as secure.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Serves the React web build (apps/web/dist, copied to
 * resources/web at package time — see electron-builder.yml
 * extraResources) from app://lab/*. Call after app.whenReady().
 */
export function handleAppScheme(webRoot: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    // app://lab/some/path -> <webRoot>/some/path ; app://lab/ -> index.html
    const relative = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
    const filePath = path.join(webRoot, relative);

    // Guard against path traversal via a crafted app:// URL.
    if (!filePath.startsWith(webRoot)) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}
