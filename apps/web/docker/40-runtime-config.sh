#!/bin/sh
set -e
# 1) window.__LAB__ for the SPA: LiveKit is reached through this same origin
#    at /livekit, so it works from any hostname/IP without a rebuild.
cat > /usr/share/nginx/html/config.js <<'JS'
(function () {
  var wsProto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  window.__LAB__ = {
    platform: 'web',
    serverUrl: location.origin,
    livekitUrl: wsProto + location.host + '/livekit'
  };
})();
JS

# 2) Self-signed TLS cert on first start, unless one was mounted in. Also
#    self-heals when HOST_IP/TLS_CN changes (e.g. .env pointed at the wrong
#    adapter and got corrected) — a named volume persists the cert across
#    container recreation, so editing .env alone would otherwise leave
#    stations stuck re-trusting a stale address until someone deleted the
#    cert by hand. The stamp file is what makes this safe: it is only ever
#    written by this script right after IT generates a cert, so a cert an
#    operator mounted in (no stamp) is never regenerated/overwritten here.
mkdir -p /etc/nginx/certs
CN="${TLS_CN:-lab.local}"
SAN="DNS:${CN},DNS:localhost,IP:127.0.0.1"
[ -n "${TLS_EXTRA_SAN:-}" ] && SAN="${SAN},${TLS_EXTRA_SAN}"
STAMP=/etc/nginx/certs/tls.generated-san

GENERATE=0
if [ ! -s /etc/nginx/certs/tls.crt ] || [ ! -s /etc/nginx/certs/tls.key ]; then
  GENERATE=1
elif [ -f "$STAMP" ] && [ "$(cat "$STAMP")" != "$SAN" ]; then
  echo "[40-runtime-config] HOST_IP/TLS_CN changed since this cert was generated — regenerating"
  GENERATE=1
fi

if [ "$GENERATE" = "1" ]; then
  echo "[40-runtime-config] generating self-signed certificate (${SAN})"
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout /etc/nginx/certs/tls.key -out /etc/nginx/certs/tls.crt \
    -subj "/CN=${CN}" -addext "subjectAltName=${SAN}"
  echo "$SAN" > "$STAMP"
fi
