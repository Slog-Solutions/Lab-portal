/**
 * Round Table (Annexure-I Ser 3) live state. The SERVER owns the floor: it
 * decides who may speak and enforces that by changing LiveKit publish
 * permissions, so a modified client cannot talk out of turn. Everything
 * here is keyed by `stationId` (a seat), never `studentId` — a seat can be
 * unclaimed at runtime (see the identity note in activities/definitions.ts).
 */
export interface RoundTableFloor {
  groupId: string;
  chairmanStationId: string;
  speakerStationId: string | null;
  /** stationIds waiting for the floor, FIFO, no duplicates. */
  queue: string[];
  teacher: 'absent' | 'listening' | 'speaking';
  /** Server epoch ms the current member turn began, or null. */
  turnStartedAt: number | null;
  /** Monotonic; clients drop any update lower than the one they show. */
  seq: number;
  /** Mirrors the session: nobody but the chairman/teacher may act unless RUNNING. */
  phase: 'ARMED' | 'RUNNING' | 'PAUSED';
  /** Manual-chair group whose chairman has been offline >20s: floor is frozen. */
  chairmanOffline: boolean;
}

export interface RoundTableMember {
  stationId: string;
  /** Null for a station that has not been placed on the seat map yet. */
  seatNo: number | null;
  /** Null when the seat is not claimed by a student right now. */
  studentName: string | null;
}

/** What a Round Table station receives on its desired-state snapshot. */
export interface RoundTableView {
  topic: string;
  floor: RoundTableFloor;
  members: RoundTableMember[];
}
