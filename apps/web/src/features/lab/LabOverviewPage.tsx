import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Minus, MonitorCog } from 'lucide-react';
import { getActivity, hasActivity } from '@lab/shared/activities';
import type { ActivityType } from '@lab/shared';
import { classroomApi } from '../../lib/classroom-api';
import { gradebookApi, type AttemptRow } from '../../lib/gradebook-api';
import { queryKeys } from '../../lib/query-keys';
import { useAuthStore } from '../../stores/auth-store';
import { PageTitle } from '@/components/layout/PageTitle';
import { Panel } from '@/components/layout/Panel';
import { ChartLegend, ColumnChart, LineChart, RadarChart, RadialRings, SparkBars, SparkLine } from '@/components/charts/charts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import illustrationUrl from '@/assets/illustrations/mobile-login.svg';
import { STUDENT_SEATS, TOTAL_SEATS, useLabStatus } from './use-lab-status';

const DAYS = 14;
const DAY_MS = 86_400_000;
const TREND_WINDOW_MS = 10 * 60_000;

// The four scored test types, always shown on the radar in this order.
const TEST_TYPES = ['VOCABULARY_TEST', 'WRITING_TEST', 'LISTENING_TEST', 'READING_TEST'] as const;

function activityLabel(type: string): string {
  return hasActivity(type as ActivityType) ? getActivity(type as ActivityType).label : type;
}

/** Final percentage for a submitted attempt — an override wins over the raw score. */
function scorePercent(a: AttemptRow): number | null {
  const raw = a.scoreOverride?.newScore ?? a.rawScore;
  if (raw === null || !a.maxScore) return null;
  return Math.round((raw / a.maxScore) * 100);
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dayNumFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return dayFmt.format(new Date(iso));
}

type Delta = { text: string; dir: 'up' | 'down' | 'flat' } | null;

/** Stat card with a sparkline: label, big figure, change vs a baseline, and the trend. */
function TrendCard({
  label,
  value,
  unit,
  delta,
  caption,
  chart,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta: Delta;
  caption: string;
  chart: ReactNode;
}) {
  const DeltaIcon = delta?.dir === 'up' ? ArrowUp : delta?.dir === 'down' ? ArrowDown : Minus;
  return (
    <section className="flex h-full flex-col justify-between rounded-card border border-hairline bg-card p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-baseline gap-1.5">
            <span className="text-[2rem] font-bold leading-none tracking-tight text-foreground tabular-nums">{value}</span>
            {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
          </p>
          <p className="mt-4 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {delta && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 font-semibold',
                  delta.dir === 'up' ? 'text-status-online' : delta.dir === 'down' ? 'text-status-offline' : 'text-muted-foreground',
                )}
              >
                <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
                {delta.text}
              </span>
            )}
            <span className="truncate">{caption}</span>
          </p>
        </div>
        {chart}
      </div>
    </section>
  );
}

/**
 * Lab control — the read-mostly overview: what the lab looks like right
 * now, how it has moved over the last hour, and how students are doing.
 * Everything you *do* to seats lives on Class control.
 */
export function LabOverviewPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';
  const lab = useLabStatus();
  const { data: currentClass } = useQuery({ queryKey: ['classroom', 'current'], queryFn: classroomApi.current });
  const { data: attempts, isLoading: attemptsLoading } = useQuery({
    queryKey: queryKeys.gradebookAttempts({}),
    queryFn: () => gradebookApi.listAttempts({}),
    refetchInterval: 60_000,
  });

  const classLive = currentClass?.state === 'ACTIVE';
  const attentionCount = lab.errorCount + lab.unclaimed.length;
  const firstName = user?.fullName?.split(/\s+/)[0] ?? 'there';

  const submissions = useMemo(() => {
    const submitted = (attempts ?? []).filter((a) => a.submittedAt);
    const today = startOfDay(Date.now());
    const firstDay = today - (DAYS - 1) * DAY_MS;
    const perDay = Array.from({ length: DAYS }, (_, i) => {
      const day = firstDay + i * DAY_MS;
      return { key: String(day), label: dayNumFmt.format(day), detail: weekdayFmt.format(day), value: 0 };
    });
    for (const a of submitted) {
      const idx = Math.floor((startOfDay(new Date(a.submittedAt!).getTime()) - firstDay) / DAY_MS);
      if (idx >= 0 && idx < DAYS) perDay[idx]!.value++;
    }
    const thisWeek = perDay.slice(7).reduce((n, d) => n + d.value, 0);
    const lastWeek = perDay.slice(0, 7).reduce((n, d) => n + d.value, 0);

    const byType = new Map<string, { sum: number; n: number }>();
    for (const a of submitted) {
      const pct = scorePercent(a);
      if (pct === null) continue;
      const cur = byType.get(a.exercise.type) ?? { sum: 0, n: 0 };
      byType.set(a.exercise.type, { sum: cur.sum + pct, n: cur.n + 1 });
    }
    const radar = TEST_TYPES.map((type) => {
      const t = byType.get(type);
      return { key: type, label: activityLabel(type).replace(/ Test$/, ''), value: t ? Math.round(t.sum / t.n) : null, n: t?.n ?? 0 };
    });

    const scored = submitted.map(scorePercent).filter((p): p is number => p !== null);
    return {
      perDay,
      thisWeek,
      lastWeek,
      radar,
      overallAvg: scored.length ? Math.round(scored.reduce((n, p) => n + p, 0) / scored.length) : null,
      recent: [...submitted].sort((a, b) => b.submittedAt!.localeCompare(a.submittedAt!)).slice(0, 6),
    };
  }, [attempts]);

  // Online now vs the reading closest to 10 minutes ago.
  const onlineDelta: Delta = useMemo(() => {
    const h = lab.history;
    if (h.length < 2) return null;
    const latest = h[h.length - 1]!;
    const base = h.find((s) => s.x >= latest.x - TREND_WINDOW_MS) ?? h[0]!;
    if (base === latest) return null;
    const diff = latest.online - base.online;
    return { text: diff === 0 ? 'no change' : `${diff > 0 ? '+' : ''}${diff}`, dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
  }, [lab.history]);

  const weekDelta: Delta =
    submissions.lastWeek === 0
      ? submissions.thisWeek > 0
        ? { text: 'new', dir: 'up' }
        : null
      : (() => {
          const pct = Math.round(((submissions.thisWeek - submissions.lastWeek) / submissions.lastWeek) * 100);
          return { text: `${Math.abs(pct)}%`, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
        })();

  const latest = lab.history[lab.history.length - 1];
  const hasScores = submissions.radar.some((r) => r.value !== null);

  return (
    <div>
      <PageTitle
        title="Lab control"
        subtitle={`Overview of all ${TOTAL_SEATS} consoles · live over the control socket`}
        breadcrumbs={[{ label: 'Digital Language Lab', to: '/dashboard' }, { label: 'Lab control' }]}
        actions={
          <Button asChild size="sm">
            <Link to="/class-control">
              <MonitorCog />
              Open class control
            </Link>
          </Button>
        }
      />

      {/* Row 1 — welcome + two trend cards */}
      <div className="grid grid-cols-1 gap-grid-gap md:grid-cols-2 xl:grid-cols-3">
        <section className="flex items-center justify-between gap-4 overflow-hidden rounded-card border border-hairline bg-card p-5 md:col-span-2 xl:col-span-1">
          <div className="min-w-0">
            <p className="text-lg leading-snug text-foreground">
              Welcome back, <span className="font-bold">{firstName}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {classLive && currentClass ? (
                <>
                  Class live · code <span className="font-mono font-semibold text-foreground">{currentClass.code}</span>
                </>
              ) : (
                'No class running yet'
              )}
            </p>
            <Link to="/class-control" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
              {classLive ? 'Go to class control' : 'Start a class'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <img src={illustrationUrl} alt="" aria-hidden className="h-28 w-28 shrink-0 object-contain" />
        </section>

        <TrendCard
          label="Stations online"
          value={lab.onlineCount}
          unit={`/ ${TOTAL_SEATS}`}
          delta={onlineDelta}
          caption={onlineDelta ? 'vs 10 min ago' : 'live'}
          chart={<SparkLine values={lab.history.slice(-40).map((s) => s.online)} color="var(--color-chart-1)" ariaLabel="Stations online, recent trend" />}
        />

        <TrendCard
          label="Submissions this week"
          value={submissions.thisWeek}
          delta={weekDelta}
          caption="vs previous week"
          chart={
            <SparkBars
              values={submissions.perDay.map((d) => d.value)}
              labels={submissions.perDay.map((d) => `${d.detail}: ${d.value}`)}
              color="var(--color-chart-3)"
              ariaLabel={`Submissions per day, last ${DAYS} days`}
            />
          }
        />
      </div>

      {/* Row 2 — radar, rings, columns */}
      <div className="mt-grid-gap grid grid-cols-1 gap-grid-gap md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Scores by test type" description="Average across all scored submissions">
          {hasScores || attemptsLoading ? (
            <RadarChart
              axes={submissions.radar}
              color="var(--color-chart-1)"
              formatValue={(v) => `${v}%`}
              ariaLabel="Average score by test type"
            />
          ) : (
            <div className="flex h-[280px] items-center justify-center rounded-control border border-dashed border-input px-6 text-center text-xs text-muted-foreground">
              Scores appear here once tests are marked.
            </div>
          )}
          {hasScores && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Overall average <span className="font-semibold text-foreground">{submissions.overallAvg}%</span>
            </p>
          )}
        </Panel>

        <Panel title="Lab right now" description="Share of seats in each condition">
          <RadialRings
            rings={[
              { key: 'online', label: 'Online', value: lab.onlineCount, max: TOTAL_SEATS, color: 'var(--color-chart-1)' },
              { key: 'seated', label: 'Seated', value: lab.seatedCount, max: STUDENT_SEATS, color: 'var(--color-chart-2)' },
              { key: 'locked', label: 'Locked', value: lab.lockedCount, max: Math.max(1, lab.onlineCount), color: 'var(--color-chart-3)' },
            ]}
            centerValue={TOTAL_SEATS}
            centerLabel="Seats"
            ariaLabel="Seats online, seated and locked"
          />
          <ul className="mt-4 space-y-2 text-xs">
            {[
              { label: 'Online', value: `${lab.onlineCount} / ${TOTAL_SEATS}`, color: 'var(--color-chart-1)' },
              { label: 'Seated', value: `${lab.seatedCount} / ${STUDENT_SEATS}`, color: 'var(--color-chart-2)' },
              { label: 'Locked', value: `${lab.lockedCount} of ${lab.onlineCount} online`, color: 'var(--color-chart-3)' },
            ].map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: r.color }} aria-hidden />
                  {r.label}
                </span>
                <span className="font-semibold text-foreground tabular-nums">{r.value}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 border-t border-hairline pt-2">
              <span className={cn('flex items-center gap-2', attentionCount > 0 ? 'text-status-offline' : 'text-muted-foreground')}>
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Needs attention
              </span>
              <span className="font-semibold text-foreground tabular-nums">
                {lab.errorCount} error{lab.errorCount === 1 ? '' : 's'} · {lab.unclaimed.length} unassigned
              </span>
            </li>
          </ul>
        </Panel>

        <Panel
          className="md:col-span-2 xl:col-span-1"
          title="Submissions per day"
          description={`Last ${DAYS} days`}
          actions={
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">Total</p>
              <p className="text-base font-bold text-foreground tabular-nums">{submissions.perDay.reduce((n, d) => n + d.value, 0)}</p>
            </div>
          }
        >
          <ColumnChart
            data={submissions.perDay}
            color="var(--color-chart-3)"
            label="Submissions"
            height={300}
            showValues
            empty={attemptsLoading ? 'Loading submissions…' : `No submissions in the last ${DAYS} days.`}
            ariaLabel={`Submissions per day, last ${DAYS} days`}
          />
        </Panel>
      </div>

      {/* Row 3 — live occupancy + class */}
      <div className="mt-grid-gap grid grid-cols-1 gap-grid-gap xl:grid-cols-12">
        <Panel
          className="xl:col-span-8"
          title="Lab occupancy"
          description="Live — sampled every 30 s while Lab control or Class control is open"
          actions={
            <ChartLegend
              items={[
                { label: 'Online', color: 'var(--color-chart-1)', value: latest?.online ?? lab.onlineCount },
                { label: 'Seated', color: 'var(--color-chart-2)', value: latest?.seated ?? lab.seatedCount },
              ]}
            />
          }
        >
          <LineChart
            data={lab.history}
            series={[
              { key: 'online', label: 'Online', color: 'var(--color-chart-1)' },
              { key: 'seated', label: 'Seated', color: 'var(--color-chart-2)' },
            ]}
            yMax={TOTAL_SEATS}
            height={240}
            formatX={(x) => timeFmt.format(x)}
            empty="Collecting live readings — the trend appears after the first minute."
            ariaLabel="Stations online and students seated over time"
          />
        </Panel>

        <Panel
          className="xl:col-span-4"
          title="Current class"
          description={isAdmin ? 'Lab-wide live class' : 'Your live class'}
          actions={<Badge variant={classLive ? 'success' : 'secondary'}>{classLive ? 'Live' : 'Standby'}</Badge>}
        >
          <div className="flex h-full flex-col gap-4">
            {classLive && currentClass ? (
              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Title</dt>
                  <dd className="truncate font-medium text-foreground">{currentClass.title}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Class code</dt>
                  <dd className="font-mono font-bold tracking-widest text-foreground">{currentClass.code}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Students joined</dt>
                  <dd className="font-semibold text-foreground tabular-nums">{currentClass.memberCount}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No class is running. Start one from Class control to give students a join code.</p>
            )}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Seats filled</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {lab.seatedCount} / {STUDENT_SEATS}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-pill bg-muted">
                <div className="h-full rounded-pill bg-brand" style={{ width: `${Math.min(100, Math.round((lab.seatedCount / STUDENT_SEATS) * 100))}%` }} />
              </div>
            </div>
            <Button asChild variant="outline" className="mt-auto w-full">
              <Link to="/class-control">
                {classLive ? 'Manage class' : 'Start a class'}
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </Panel>
      </div>

      {/* Row 4 — recent work */}
      <Panel
        className="mt-grid-gap"
        title="Recent submissions"
        description="Latest work handed in by students"
        actions={
          <Link to="/gradebook" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
            Open gradebook
            <ArrowRight className="h-3 w-3" />
          </Link>
        }
        bodyClassName="px-0 pb-2"
      >
        {submissions.recent.length === 0 ? (
          <p className="mx-5 mb-3 rounded-control border border-dashed border-input px-4 py-8 text-center text-xs text-muted-foreground">
            {attemptsLoading ? 'Loading…' : 'Nothing submitted yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-y border-hairline bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Student</th>
                  <th className="px-3 py-2.5 font-semibold">Work</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Score</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {submissions.recent.map((a) => {
                  const pct = scorePercent(a);
                  return (
                    <tr key={a.id}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground">{a.student.fullName}</p>
                        <p className="text-xs text-muted-foreground">{a.student.serviceNumber}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="truncate text-foreground">{a.exercise.title}</p>
                        <p className="text-xs text-muted-foreground">{activityLabel(a.exercise.type)}</p>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-foreground">
                        {pct === null ? <span className="font-normal text-muted-foreground">To mark</span> : `${pct}%`}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-muted-foreground">{relativeTime(a.submittedAt!)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
