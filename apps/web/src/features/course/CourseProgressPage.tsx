import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Play } from 'lucide-react';
import type { CourseProgressView, CourseResultView as Result } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { englishCourseApi } from '../../lib/english-course-api';
import { CourseResultView, formatDuration } from './CourseResultView';
import { useCourseSpeech } from './use-course-speech';
import { ChartLegend, LineChart } from '@/components/charts/charts';
import { Button } from '@/components/ui/button';

const SKILL_COLORS = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-status-pending)', 'var(--color-status-info)'];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Every score over time, per skill, one line each — x is the attempt's
 * position in time order so days with many attempts don't bunch up. */
function skillChartData(progress: CourseProgressView) {
  const points = progress.bySkill
    .flatMap((s) => s.series.map((p) => ({ skill: s.skill, at: p.at, score: p.score })))
    .sort((a, b) => a.at.localeCompare(b.at));
  const last: Record<string, number> = {};
  return points.map((p, i) => {
    last[p.skill] = p.score;
    return { x: i, ...last } as { x: number } & Record<string, number>;
  });
}

/**
 * Ser 10 "A personal progress page to chart scores and assess progress" /
 * "Result Tracking ... they can see their scores from all previous tests
 * and check their progress". The same view is what a teacher opens for a
 * student (TeacherCourseProgress).
 */
export function ProgressBody({
  progress,
  onOpenAttempt,
  onOpenActivity,
  playRecording,
}: {
  progress: CourseProgressView;
  onOpenAttempt?: (attemptId: string) => void;
  onOpenActivity?: (key: string) => void;
  playRecording?: (id: string) => void;
}) {
  const data = skillChartData(progress);
  const series = progress.bySkill.map((s, i) => ({ key: s.skill, label: s.skill[0]!.toUpperCase() + s.skill.slice(1), color: SKILL_COLORS[i % SKILL_COLORS.length]! }));
  const t = progress.totals;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Average score', t.average !== null ? `${Math.round(t.average)}%` : '—'],
          ['Activities done', `${t.activitiesDone} / ${t.activitiesTotal}`],
          ['Attempts', String(t.attempts)],
          ['Time practised', `${t.minutes} min`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-card border border-hairline bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <section className="rounded-card border border-hairline bg-card p-5">
        <h3 className="mb-3 font-semibold">Scores over time</h3>
        <LineChart
          data={data}
          series={series}
          yMax={100}
          formatX={(x) => String(x + 1)}
          formatY={(y) => `${Math.round(y)}%`}
          empty="Complete two scored activities to see your progress line."
          ariaLabel="Scores over time by skill"
        />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-card border border-hairline bg-card p-5">
          <h3 className="mb-3 font-semibold">By skill area</h3>
          <ul className="space-y-3">
            {progress.byTrack.map((tr) => (
              <li key={tr.track} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{tr.title}</span>
                  <span className="text-muted-foreground">
                    {tr.done}/{tr.total} · avg {tr.average !== null ? `${Math.round(tr.average)}%` : '—'}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-brand" style={{ width: `${tr.total ? (tr.done / tr.total) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-card border border-hairline bg-card p-5">
          <h3 className="mb-1 font-semibold">Areas to review</h3>
          <p className="mb-3 text-xs text-muted-foreground">From your latest try at each activity.</p>
          {progress.reviewAreas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to review — well done.</p>
          ) : (
            <ul className="space-y-1.5">
              {progress.reviewAreas.slice(0, 8).map((a) => (
                <li key={a.tag} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {a.label} <span className="text-xs text-muted-foreground">({a.missed}/{a.total} wrong)</span>
                  </span>
                  {a.activityKey && onOpenActivity && (
                    <Button size="sm" variant="outline" onClick={() => onOpenActivity(a.activityKey!)}>
                      Study
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {progress.readingSpeed.length > 0 && (
        <section className="rounded-card border border-hairline bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Reading speed</h3>
            <ChartLegend
              items={[
                { label: 'Words per minute', color: 'var(--color-chart-3)', value: `latest ${progress.readingSpeed.at(-1)!.wpm}` },
                { label: 'Comprehension %', color: 'var(--color-chart-1)', value: `latest ${Math.round(progress.readingSpeed.at(-1)!.comprehension)}%` },
                {
                  label: 'Best effective speed',
                  color: 'transparent',
                  value: `${Math.max(...progress.readingSpeed.map((r) => Math.round((r.wpm * r.comprehension) / 100)))} wpm`,
                },
              ]}
            />
          </div>
          <LineChart
            data={progress.readingSpeed.map((r, i) => ({ x: i, wpm: r.wpm, comprehension: r.comprehension }))}
            series={[
              { key: 'wpm', label: 'Words per minute', color: 'var(--color-chart-3)' },
              { key: 'comprehension', label: 'Comprehension %', color: 'var(--color-chart-1)' },
            ]}
            formatX={(x) => String(x + 1)}
            empty="Read two passages to see your reading speed."
            ariaLabel="Reading speed over time"
          />
        </section>
      )}

      <section className="rounded-card border border-hairline bg-card p-5">
        <h3 className="mb-3 font-semibold">All my results</h3>
        {progress.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No results yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Date</th>
                <th className="py-1 font-normal">Activity</th>
                <th className="py-1 text-right font-normal">Time</th>
                <th className="py-1 text-right font-normal">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {progress.recent.map((r) => (
                <tr key={r.attemptId} className={onOpenAttempt ? 'cursor-pointer hover:bg-accent' : undefined} onClick={() => onOpenAttempt?.(r.attemptId)}>
                  <td className="py-1.5 text-muted-foreground">{fmtDate(r.at)}</td>
                  <td className="py-1.5">{r.title}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{r.durationMs !== null ? formatDuration(r.durationMs) : '—'}</td>
                  <td className="py-1.5 text-right font-medium">{r.score !== null ? `${Math.round(r.score)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-card border border-hairline bg-card p-5">
        <h3 className="mb-3 font-semibold">My recordings</h3>
        {progress.recordings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Recordings you make in speaking and rhythm activities are kept here.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {progress.recordings.map((rec) => (
              <li key={rec.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {rec.title} <span className="text-xs text-muted-foreground">· {fmtDate(rec.createdAt)}</span>
                </span>
                {playRecording && (
                  <Button size="sm" variant="ghost" onClick={() => playRecording(rec.id)}>
                    <Play className="mr-1 h-4 w-4" /> Play
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function CourseProgressPage({
  control,
  onBack,
  onOpenActivity,
}: {
  control: StationControlClient;
  onBack: () => void;
  onOpenActivity: (key: string) => void;
}) {
  const speech = useCourseSpeech(control);
  const [openResult, setOpenResult] = useState<Result | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const progress = useQuery({ queryKey: ['english-course', 'progress'], queryFn: () => englishCourseApi.progress(control.getToken()) });

  async function playRecording(id: string): Promise<void> {
    const url = await englishCourseApi.recordingUrl(control.getToken(), id);
    if (playing) URL.revokeObjectURL(playing);
    setPlaying(url);
    void new Audio(url).play();
  }

  if (openResult) {
    return (
      <div className="w-full max-w-4xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setOpenResult(null)}>
          <ArrowLeft className="mr-1 h-4 w-4" /> My progress
        </Button>
        <div className="rounded-card border border-hairline bg-card p-5">
          <h2 className="mb-4 text-lg font-semibold">{openResult.activity.title}</h2>
          <CourseResultView result={openResult} speech={speech} onOpenActivity={onOpenActivity} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Course
        </Button>
        <h2 className="text-xl font-semibold">My progress</h2>
      </div>
      {progress.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {progress.error && <p className="text-sm text-destructive">{progress.error.message}</p>}
      {progress.data && (
        <ProgressBody
          progress={progress.data}
          onOpenActivity={onOpenActivity}
          onOpenAttempt={(id) => void englishCourseApi.result(control.getToken(), id).then(setOpenResult)}
          playRecording={(id) => void playRecording(id)}
        />
      )}
    </div>
  );
}
