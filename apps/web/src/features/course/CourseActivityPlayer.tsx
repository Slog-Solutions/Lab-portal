import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { CourseResultView as Result, StartedCourseActivity } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { englishCourseApi } from '../../lib/english-course-api';
import { CourseResultView } from './CourseResultView';
import { useCourseSpeech } from './use-course-speech';
import { QuizPlayer } from './players/QuizPlayer';
import { PairsGamePlayer } from './players/PairsGamePlayer';
import { TutorialPlayer } from './players/TutorialPlayer';
import { IpaChartPlayer } from './players/IpaChartPlayer';
import { BackchainPlayer } from './players/BackchainPlayer';
import { RhythmTextPlayer } from './players/RhythmTextPlayer';
import { ListeningPlayer } from './players/ListeningPlayer';
import { ListenRespondPlayer } from './players/ListenRespondPlayer';
import { SpeedReadingPlayer } from './players/SpeedReadingPlayer';
import { WritingPlayer } from './players/WritingPlayer';
import type { PlayerProps } from './players/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const KIND_LABEL: Record<string, string> = {
  'ipa-chart': 'Chart',
  'pairs-game': 'Game',
  quiz: 'Exercise',
  tutorial: 'Tutorial',
  backchain: 'Speaking',
  'rhythm-text': 'Rhythm',
  listening: 'Listening',
  'listen-respond': 'Listen & respond',
  'note-taking': 'Note-taking',
  'speed-reading': 'Speed reading',
  'grammar-lesson': 'Grammar',
  writing: 'Writing',
};

/** In-flight starts by activity+assignment. An effect that runs twice (React
 * StrictMode in dev, or a fast remount) must share one server start —
 * otherwise each creates its own attempt and one is left IN_PROGRESS forever. */
const pendingStarts = new Map<string, Promise<StartedCourseActivity>>();

function startOnce(control: StationControlClient, key: string, assignmentId: string | undefined, run: number): Promise<StartedCourseActivity> {
  const id = `${key}|${assignmentId ?? ''}|${run}`;
  let pending = pendingStarts.get(id);
  if (!pending) {
    pending = englishCourseApi.start(control.getToken(), key, assignmentId);
    pendingStarts.set(id, pending);
    const clear = () => setTimeout(() => pendingStarts.delete(id), 1000);
    pending.then(clear, clear);
  }
  return pending;
}

function Player(props: PlayerProps) {
  switch (props.activity.kind) {
    case 'pairs-game':
      return <PairsGamePlayer {...props} />;
    case 'tutorial':
      return <TutorialPlayer {...props} />;
    case 'ipa-chart':
      return <IpaChartPlayer {...props} />;
    case 'backchain':
      return <BackchainPlayer {...props} />;
    case 'rhythm-text':
      return <RhythmTextPlayer {...props} />;
    case 'listening':
    case 'note-taking':
      return <ListeningPlayer {...props} />;
    case 'listen-respond':
      return <ListenRespondPlayer {...props} />;
    case 'speed-reading':
      return <SpeedReadingPlayer {...props} />;
    case 'writing':
      return <WritingPlayer {...props} />;
    default:
      return <QuizPlayer {...props} />;
  }
}

/**
 * Hosts one course activity from start to result: starts (or resumes) the
 * attempt, keeps the answers, submits, and shows the graded result. Used by
 * the English Course section and by Assignments (with `assignmentId`, so a
 * teacher's course target is credited).
 */
export function CourseActivityPlayer({
  control,
  activityKey,
  assignmentId,
  onClose,
  onOpenActivity,
}: {
  control: StationControlClient;
  activityKey: string;
  assignmentId?: string;
  onClose: () => void;
  onOpenActivity?: (key: string) => void;
}) {
  const speech = useCourseSpeech(control);
  const [started, setStarted] = useState<StartedCourseActivity | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const startedAtRef = useRef(Date.now());
  const answersRef = useRef(answers);
  answersRef.current = answers;

  useEffect(() => {
    let cancelled = false;
    setStarted(null);
    setResult(null);
    setAnswers({});
    setError(null);
    startOnce(control, activityKey, assignmentId, run)
      .then((res) => {
        if (cancelled) return;
        startedAtRef.current = Date.now();
        setStarted(res);
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Could not open this activity'));
    return () => {
      cancelled = true;
    };
  }, [control, activityKey, assignmentId, run]);

  const setAnswer = useCallback((itemId: string, value: string) => setAnswers((prev) => ({ ...prev, [itemId]: value })), []);

  const onSubmit = useCallback(
    (extra?: { readingMs?: number }) => {
      if (!started) return;
      setSubmitting(true);
      setError(null);
      speech.stop();
      englishCourseApi
        .submit(control.getToken(), started.attemptId, {
          answers: answersRef.current,
          durationMs: Date.now() - startedAtRef.current,
          ...(extra?.readingMs ? { readingMs: Math.round(extra.readingMs) } : {}),
        })
        .then((res) => {
          // A reopen within the start cache's 1s window must not get this (now submitted) attempt back.
          pendingStarts.clear();
          setResult(res);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not submit'))
        .finally(() => setSubmitting(false));
    },
    [control, started, speech],
  );

  const activity = started?.activity;

  return (
    <div className="w-full max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        {activity && (
          <>
            <h2 className="text-lg font-semibold">{activity.title}</h2>
            <Badge variant="secondary">{KIND_LABEL[activity.kind] ?? activity.kind}</Badge>
            <Badge variant="outline">{activity.cefr}</Badge>
            {activity.mode === 'test' && <Badge variant="info">Test</Badge>}
          </>
        )}
      </div>

      <div className="rounded-card border border-hairline bg-card p-5">
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {!started && !error && <p className="text-sm text-muted-foreground">Opening…</p>}
        {result ? (
          <CourseResultView
            result={result}
            speech={speech}
            onRetry={() => setRun((r) => r + 1)}
            onOpenActivity={onOpenActivity}
            onBack={onClose}
          />
        ) : (
          activity && (
            <div className="space-y-4">
              {activity.intro && <p className="text-sm text-muted-foreground">{activity.intro}</p>}
              <Player
                key={started.attemptId}
                activity={activity}
                attemptId={started.attemptId}
                answers={answers}
                setAnswer={setAnswer}
                speech={speech}
                control={control}
                submitting={submitting}
                onSubmit={onSubmit}
              />
              {speech.error && activity.kind !== 'pairs-game' && activity.kind !== 'ipa-chart' && (
                <p className="text-xs text-status-pending">{speech.error}</p>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
