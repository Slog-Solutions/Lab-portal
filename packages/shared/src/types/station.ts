import type { ActivityType, SessionRole, StationLifecycle } from './enums.js';

/** Seat 1 is always the teacher seat ('T'); every other seat is
 * `seatNo - 1` (the number a student actually typed at sign-in — see
 * seatNoFromSystemNumber). `null` means the station hasn't been claimed
 * or sat at yet. Centralized here so the status board, seat grid and
 * session builder never re-derive this convention slightly differently. */
export function seatLabel(seatNo: number | null): string {
  if (seatNo === null) return '?';
  if (seatNo === 1) return 'T';
  return String(seatNo - 1);
}

/** The inverse of seatLabel for student-facing seats: the number a
 * student sees printed on their PC's screen ("system number") maps to
 * `seatNo = n + 1`, leaving seat 1 permanently reserved for the teacher. */
export function seatNoFromSystemNumber(systemNumber: number): number {
  return systemNumber + 1;
}

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
  /** Station-scoped JWT (Phase 3 — see auth.service.ts's mintStationToken),
   * re-minted on every hello. Used as the Authorization bearer for the
   * station's own HTTP calls (recordings, attempts) — never for dashboard
   * routes, which a station-kind token cannot pass @Roles() for. */
  token: string;
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
  /** The student currently signed in at this seat (Station.currentUserId
   * — StationsService.claim, a real credentialed login). Null until a
   * student signs in with their service number, password, system number
   * and classroom code, or after the class ends / an admin or teacher
   * releases the seat. */
  currentUser: { id: string; serviceNumber: string; fullName: string } | null;
  /** The classroom this seat is currently in (Station.liveClassId), set
   * together with currentUser at sign-in and cleared together with it —
   * null exactly when currentUser is null. */
  liveClass: { id: string; title: string; teacherName: string } | null;
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
