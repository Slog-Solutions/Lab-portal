import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Mic, Play, Users, Video } from 'lucide-react';
import type { ClassActivityEntry, ClassAssignmentEntry, ClassRecordingHistoryEntry } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi } from '../../lib/station-api';
import { batchesApi } from '../../lib/batches-api';
import { queryKeys } from '../../lib/query-keys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const ROLE_LABEL: Record<string, string> = {
  CHAIRMAN: 'Chairman',
  INTERPRETER: 'Interpreter',
  DELEGATE: 'Delegate',
  OBSERVER: 'Observer',
};

const LIVE_STATES = new Set(['ARMED', 'RUNNING', 'PAUSED']);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

/**
 * One of the student's classes, opened from My Classes: every live activity
 * they took part in there (with their own recordings to play back and, for
 * a Round Table, their time on the floor) and every assignment the teacher
 * created from this class. Read-only — assignments are started from the
 * Assignments section.
 *
 * `active` is whether this screen is visible: the console keeps sections
 * mounted, so the history is refetched each time it is shown again.
 */
export function StudentClassDetail({
  classId,
  control,
  active,
  onBack,
  onOpenAssignments,
}: {
  classId: string;
  control: StationControlClient;
  active: boolean;
  onBack: () => void;
  onOpenAssignments: () => void;
}) {
  const history = useQuery({ queryKey: queryKeys.classHistory(classId), queryFn: () => batchesApi.myActivity(classId) });

  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void history.refetch();
    wasActive.current = active;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const data = history.data;
  return (
    <div className="w-full max-w-3xl space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> My Classes
      </button>

      {history.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {history.isError && <p className="text-sm text-destructive">Could not load this class.</p>}

      {data && (
        <>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold">{data.class.name}</h2>
              <Badge variant="outline">{data.class.code}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.class.teacherNames.length > 0 ? `Taught by ${data.class.teacherNames.join(', ')}` : 'No teacher assigned yet'}
            </p>
          </div>

          {data.classRecordings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Class recording</CardTitle>
                <CardDescription>Recorded by your teacher — the whole class, not just your own turn.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.classRecordings.map((r, i) => (
                  <ClassRecordingRow key={r.id} entry={r} label={data.classRecordings.length > 1 ? `Recording ${i + 1}` : 'Class recording'} />
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Class activities</CardTitle>
              <CardDescription>Live activities you took part in during this class.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.activities.length === 0 && (
                <p className="text-sm text-muted-foreground">No activities yet. They appear here once your teacher runs one with you.</p>
              )}
              {data.activities.map((a) => (
                <ActivityRow key={`${a.sessionId}-${a.groupIndex}`} entry={a} control={control} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-base">Assignments from this class</CardTitle>
                <CardDescription>Tests your teacher set for this class.</CardDescription>
              </div>
              {data.assignments.length > 0 && (
                <Button size="sm" variant="secondary" onClick={onOpenAssignments}>
                  Open assignments
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {data.assignments.length === 0 && <p className="text-sm text-muted-foreground">No assignments from this class yet.</p>}
              {data.assignments.map((a) => (
                <AssignmentRow key={a.assignmentId} entry={a} />
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ActivityRow({ entry, control }: { entry: ClassActivityEntry; control: StationControlClient }) {
  const role = ROLE_LABEL[entry.role];
  const live = LIVE_STATES.has(entry.sessionState);
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{entry.activityLabel}</span>
        {role && <Badge variant="secondary">{role}</Badge>}
        {live && <Badge variant="success">Live now</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{formatDate(entry.date)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {entry.sessionTitle}
        {entry.topic && ` · ${entry.topic}`}
      </p>
      {entry.groupmates.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> With {entry.groupmates.join(', ')}
        </p>
      )}
      {entry.roundTable && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mic className="h-3.5 w-3.5" />
          {entry.roundTable.turns === 0
            ? 'You did not take the floor'
            : `${entry.roundTable.turns} ${entry.roundTable.turns === 1 ? 'turn' : 'turns'} · ${formatDuration(entry.roundTable.speakingMs)} speaking`}
        </p>
      )}
      {entry.recordings.length > 0 && (
        <div className="space-y-1.5">
          {entry.recordings.map((r, i) => (
            <RecordingPlayback
              key={r.id}
              recordingId={r.id}
              ready={r.status === 'ready'}
              label={entry.recordings.length > 1 ? `Your recording ${i + 1}` : 'Your recording'}
              durationMs={r.durationMs}
              control={control}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Audio needs the station token, which an <audio src> can't send — so the
 * file is fetched as a blob on demand and played from an object URL. */
function RecordingPlayback({
  recordingId,
  ready,
  label,
  durationMs,
  control,
}: {
  recordingId: string;
  ready: boolean;
  label: string;
  durationMs: number | null;
  control: StationControlClient;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  async function load(): Promise<void> {
    setLoading(true);
    setFailed(false);
    try {
      setUrl(await stationApi.fetchBlobUrl(control.getToken(), `/recordings/${recordingId}/file`));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const length = durationMs ? ` (${formatDuration(durationMs)})` : '';
  if (!ready) return <p className="text-xs text-muted-foreground">{label} is still being saved…</p>;
  if (url) return <audio controls autoPlay src={url} className="h-8 w-full" aria-label={label} />;
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
        <Play className="mr-1.5 h-3.5 w-3.5" />
        {loading ? 'Loading…' : `${label}${length}`}
      </Button>
      {failed && <span className="text-xs text-destructive">Could not load the recording.</span>}
    </div>
  );
}

/** The teacher's whole-class recording — same rows for every student, so
 * this fetches with the STUDENT session JWT (batch enrollment check),
 * not the station token RecordingPlayback uses above. A <video>, not
 * <audio>: it's the shared screen, not just a voice. */
function ClassRecordingRow({ entry, label }: { entry: ClassRecordingHistoryEntry; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  async function load(): Promise<void> {
    setLoading(true);
    setFailed(false);
    try {
      setUrl(await batchesApi.fetchClassRecordingBlob(entry.id));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const length = entry.durationMs ? ` (${formatDuration(entry.durationMs)})` : '';
  if (entry.status === 'recording') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Video className="h-3.5 w-3.5" /> {label} is still being recorded…
      </p>
    );
  }
  if (url) {
    return (
      <video
        controls
        autoPlay
        src={url}
        className="w-full rounded-md bg-black"
        style={{ maxHeight: '50vh' }}
        aria-label={label}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          // MediaRecorder-produced WebM carries no duration in its header,
          // so the seek bar reports Infinity until forced to compute it.
          if (el.duration === Infinity || Number.isNaN(el.duration)) {
            el.currentTime = 1e101;
            const onTimeUpdate = () => {
              el.currentTime = 0;
              el.removeEventListener('timeupdate', onTimeUpdate);
            };
            el.addEventListener('timeupdate', onTimeUpdate);
          }
        }}
      />
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
        <Play className="mr-1.5 h-3.5 w-3.5" />
        {loading ? 'Loading…' : `${label}${length}`}
      </Button>
      {failed && <span className="text-xs text-destructive">Could not load the recording.</span>}
    </div>
  );
}

function AssignmentRow({ entry }: { entry: ClassAssignmentEntry }) {
  const latest = entry.latestAttempt;
  const badge = !latest
    ? { text: 'To do', variant: 'outline' as const }
    : latest.status === 'SUBMITTED'
      ? { text: 'Awaiting review', variant: 'secondary' as const }
      : latest.percent !== null
        ? { text: `${latest.percent}%`, variant: latest.status === 'SCORED' ? ('success' as const) : ('secondary' as const) }
        : { text: 'In progress', variant: 'secondary' as const };
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
          {entry.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {entry.typeLabel} · Set {formatDate(entry.createdAt)}
          {entry.dueAt && ` · Due ${formatDate(entry.dueAt)}`}
        </p>
        {latest?.feedback && <p className="mt-1 text-xs text-muted-foreground">Teacher: {latest.feedback}</p>}
      </div>
      <Badge variant={badge.variant}>{badge.text}</Badge>
    </div>
  );
}
