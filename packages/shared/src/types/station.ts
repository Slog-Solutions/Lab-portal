import type { ActivityType, SessionRole, StationLifecycle } from './enums.js';

/** What a station tells the server on connect (design doc §4.2). */
export interface StationHello {
  machineGuid: string;
  hostname: string;
  macs: string[];
  appVersion: string;
  osBuild: string;
  displays: Array<{ id: string; width: number; height: number; scaleFactor: number }>;
}

export interface StationHelloAck {
  stationId: string;
  seatNo: number | null;
  serverTime: number;
  snapshotSeq: number;
}

export interface StationHeartbeat {
  seq: number;
  metrics: { cpu: number; mem: number; rttMs: number };
  lockState: { screen: boolean; input: boolean };
  activityId: string | null;
}

/** One row of the teacher/admin "lab status board". */
export interface StationStatusRow {
  stationId: string;
  seatNo: number | null;
  hostname: string;
  lifecycle: StationLifecycle;
  appVersion: string | null;
  osBuild: string | null;
  ip: string | null;
  lastSeenAt: number | null;
  sessionId: string | null;
  groupId: string | null;
  activityType: ActivityType | null;
  lock: { screen: boolean; input: boolean } | null;
  mic: boolean;
  screenSharing: boolean;
  monitored: boolean;
}

/** How a command/broadcast is addressed (design doc §4.4). */
export type CommandTarget =
  | { kind: 'all' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'stations'; stationIds: string[] }
  | { kind: 'seats'; seats: number[] };

export interface StationMediaGrant {
  room: string;
  token: string;
  publish: { mic: boolean; screen: boolean };
}

/** Session-scoped role assignment mirrored into the snapshot for the client. */
export interface StationRoleAssignment {
  sessionId: string;
  groupId: string;
  role: SessionRole;
}
