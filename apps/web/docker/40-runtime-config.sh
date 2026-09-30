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

# 2) Self-signed TLS cert on first start, unless one was mounted in.
mkdir -p /etc/nginx/certs
if [ ! -s /etc/nginx/certs/tls.crt ] || [ ! -s /etc/nginx/certs/tls.key ]; then
  CN="${TLS_CN:-lab.local}"
  SAN="DNS:${CN},DNS:localhost,IP:127.0.0.1"
  [ -n "${TLS_EXTRA_SAN:-}" ] && SAN="${SAN},${TLS_EXTRA_SAN}"
  echo "[40-runtime-config] generating self-signed certificate (${SAN})"
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout /etc/nginx/certs/tls.key -out /etc/nginx/certs/tls.crt \
    -subj "/CN=${CN}" -addext "subjectAltName=${SAN}"
fi
