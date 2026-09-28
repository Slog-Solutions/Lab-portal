import { protocol, net, session } from 'electron';
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

function toWebSocketOrigin(url: string): string {
  return url.replace(/^http/, 'ws');
}

/**
 * Content-Security-Policy for the student renderer (spec §6.3: "No fonts,
 * images or scripts may be loaded from any external origin. Keep the
 * app's CSP strict"). Applied via webRequest rather than a <meta> tag so
 * it covers BOTH the packaged app://lab/* origin AND the dev-mode Vite
 * server (http://localhost:5173) with one code path.
 *
 * SHIPPED AS REPORT-ONLY, DELIBERATELY — this is new hardening layered
 * onto every existing renderer feature (LiveKit broadcast/remote-control/
 * round-table audio, the SCORM content-package iframe, PUSH_FILE
 * downloads, ReadingTestPlayer's blob-URL iframe) in one pass, none of
 * which this change was verified live against in a real packaged app.
 * Run the app, open DevTools' Console/Security tab, exercise each of
 * those features, and fix any `Content-Security-Policy-Report-Only`
 * violation before flipping the header name below to the enforcing
 * `Content-Security-Policy`.
 */
export function applyContentSecurityPolicy(serverUrl: string, livekitUrl: string): void {
  const serverWs = toWebSocketOrigin(serverUrl);
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `connect-src 'self' ${serverUrl} ${serverWs} ${livekitUrl}`,
    `img-src 'self' blob: data: ${serverUrl}`,
    `media-src 'self' blob: data: ${serverUrl}`,
    `frame-src 'self' blob: ${serverUrl}`,
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy-Report-Only': [csp],
      },
    });
  });
}
