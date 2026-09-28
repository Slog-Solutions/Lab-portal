/** One row of GET /class-recordings — a teacher's recording of their own
 * class broadcast (screen, plus mic/screen audio when withAudio). Distinct
 * from ClassActivityEntry.recordings (a student's own activity takes) —
 * this is the teacher-facing list on the Recordings page. */
export interface ClassRecordingView {
  id: string;
  liveClassId: string | null;
  /** The live class's title at record time, or null for an admin's
   * lab-wide recording (no liveClassId). */
  classTitle: string | null;
  teacherName: string;
  withAudio: boolean;
  /** 'recording' while chunks are still arriving, 'ready' once finished
   * with real video captured, 'incomplete' when chunks stalled without a
   * finish call (e.g. a crash), 'failed' when finish() ran but not one
   * chunk ever landed — nothing to play back. */
  status: 'recording' | 'ready' | 'incomplete' | 'failed';
  durationMs: number | null;
  sizeBytes: number | null;
  createdAt: string;
  finalizedAt: string | null;
}

/** A class recording as it appears in a STUDENT's own class history
 * (ClassHistoryView.classRecordings) — every enrolled student sees the
 * same rows for their class, unlike ClassActivityEntry.recordings (each
 * student's own activity takes). 'failed' rows (nothing ever captured)
 * are left out entirely — never shown to students. */
export interface ClassRecordingHistoryEntry {
  id: string;
  classTitle: string | null;
  withAudio: boolean;
  durationMs: number | null;
  status: 'recording' | 'ready' | 'incomplete';
  createdAt: string;
}
