import { io, type Socket } from 'socket.io-client';
import { CONTROL_NAMESPACE } from '@lab/shared/events';
import { getRuntimeConfig } from './runtime-config';
import { useAuthStore } from '../stores/auth-store';

let socket: Socket | null = null;

/** One shared /control connection for dashboards (design doc §4.1) —
 * deliberately independent of any LiveKit media connection. */
export function getControlSocket(): Socket {
  if (socket) return socket;
  const { serverUrl } = getRuntimeConfig();
  socket = io(`${serverUrl}${CONTROL_NAMESPACE}`, {
    auth: { token: useAuthStore.getState().accessToken },
    autoConnect: true,
    reconnection: true,
  });
  return socket;
}
