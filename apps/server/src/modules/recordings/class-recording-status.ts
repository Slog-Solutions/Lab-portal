/** A 'recording' row with no new chunk for this long is reported as
 * 'incomplete' rather than still-in-progress (e.g. the teacher's browser
 * crashed mid-class) — everything captured up to the last chunk is still
 * playable, so this is a display hint, not a terminal state. Shared by
 * ClassRecordingsService.list (teacher's own Recordings page) and
 * ClassHistoryService (a student's class history), so the two never drift. */
const STALE_AFTER_MS = 2 * 60 * 1000;

export function deriveClassRecordingStatus(
  row: { status: string; updatedAt: Date },
  now: number = Date.now(),
): 'recording' | 'ready' | 'incomplete' | 'failed' {
  if (row.status === 'recording' && now - row.updatedAt.getTime() > STALE_AFTER_MS) return 'incomplete';
  return row.status as 'recording' | 'ready' | 'failed';
}
