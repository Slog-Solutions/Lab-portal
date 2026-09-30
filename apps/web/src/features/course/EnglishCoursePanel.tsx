import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, BookOpen, Ear, Mic, Music, PenLine, SpellCheck, type LucideIcon } from 'lucide-react';
import { CEFR_LEVELS, type CefrLevel, type CourseActivitySummary, type CourseTrack } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { englishCourseApi } from '../../lib/english-course-api';
import { CourseActivityPlayer, KIND_LABEL } from './CourseActivityPlayer';
import { CourseProgressPage } from './CourseProgressPage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const TRACK_ICON: Record<CourseTrack, LucideIcon> = {
  pronunciation: Mic,
  rhythm: Music,
  listening: Ear,
  reading: BookOpen,
  grammar: SpellCheck,
  writing: PenLine,
};

type View = { name: 'home' } | { name: 'track'; key: CourseTrack } | { name: 'activity'; key: string; from: View } | { name: 'progress' };

function ScoreChip({ progress }: { progress: CourseActivitySummary['progress'] }) {
  if (!progress || progress.attempts === 0) return <span className="text-xs text-muted-foreground">Not started</span>;
  const best = progress.best ?? 0;
  return (
    <span className={cn('text-xs font-medium', best >= 80 ? 'text-status-online' : best >= 50 ? 'text-status-pending' : 'text-destructive')}>
      Best {Math.round(best)}% · {progress.attempts}×
    </span>
  );
}

/**
 * The student's English Course section (Annexure-I Ser 10): skill tracks →
 * units → activities, a CEFR level filter, and the personal progress page.
 * Self-study — nothing here needs a teacher or a live class.
 */
export function EnglishCoursePanel({ control, active }: { control: StationControlClient; active: boolean }) {
  const [view, setView] = useState<View>({ name: 'home' });
  const [level, setLevel] = useState<CefrLevel | 'all'>('all');
  // Ser 10 Rhythm: texts can be taken unit-by-unit or by topic area.
  const [topic, setTopic] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ['english-course', 'catalog'],
    queryFn: () => englishCourseApi.catalog(control.getToken()),
    enabled: active,
  });

  // Returning from an activity refreshes the scores shown on the lists.
  useEffect(() => {
    if (active && view.name !== 'activity') void catalog.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.name, active]);

  const levels = useMemo(() => {
    const present = new Set(catalog.data?.tracks.flatMap((t) => t.units.flatMap((u) => u.activities.map((a) => a.cefr))) ?? []);
    return CEFR_LEVELS.filter((l) => present.has(l));
  }, [catalog.data]);

  const openActivity = (key: string) => setView((from) => ({ name: 'activity', key, from: from.name === 'activity' ? from.from : from }));

  if (view.name === 'activity') {
    return (
      <CourseActivityPlayer
        key={view.key}
        control={control}
        activityKey={view.key}
        onClose={() => setView(view.from)}
        onOpenActivity={openActivity}
      />
    );
  }

  if (view.name === 'progress') {
    return <CourseProgressPage control={control} onBack={() => setView({ name: 'home' })} onOpenActivity={openActivity} />;
  }

  const tracks = catalog.data?.tracks ?? [];
  const matches = (a: CourseActivitySummary) => (level === 'all' || a.cefr === level) && (!topic || view.name !== 'track' || a.topic === topic);

  const levelFilter = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="CEFR level">
      <span className="mr-1 text-xs text-muted-foreground">Level</span>
      {(['all', ...levels] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLevel(l)}
          className={cn('rounded-full border px-3 py-1 text-xs', level === l ? 'border-brand bg-brand text-brand-ink' : 'hover:bg-accent')}
        >
          {l === 'all' ? 'All' : l}
        </button>
      ))}
    </div>
  );

  if (view.name === 'track') {
    const track = tracks.find((t) => t.key === view.key);
    const Icon = TRACK_ICON[view.key];
    const topics = [...new Set(track?.units.flatMap((u) => u.activities.map((a) => a.topic)).filter((t): t is string => !!t) ?? [])].sort();
    return (
      <div className="w-full max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTopic(null);
                setView({ name: 'home' });
              }}
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Course
            </Button>
            <Icon className="h-5 w-5 text-brand" />
            <h2 className="text-xl font-semibold">{track?.title ?? ''}</h2>
          </div>
          {levelFilter}
        </div>
        {topics.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Topic">
            <span className="mr-1 text-xs text-muted-foreground">Topic</span>
            {[null, ...topics].map((t) => (
              <button
                key={t ?? 'all'}
                type="button"
                onClick={() => setTopic(t)}
                className={cn('rounded-full border px-3 py-1 text-xs', topic === t ? 'border-brand bg-brand text-brand-ink' : 'hover:bg-accent')}
              >
                {t ?? 'All units'}
              </button>
            ))}
          </div>
        )}
        {track?.units.map((unit) => {
          const acts = unit.activities.filter(matches);
          if (acts.length === 0) return null;
          return (
            <section key={unit.key} className="rounded-card border border-hairline bg-card">
              <header className="px-5 pt-4">
                <h3 className="font-semibold">{unit.title}</h3>
                {unit.description && <p className="text-xs text-muted-foreground">{unit.description}</p>}
              </header>
              <ul className="divide-y divide-hairline p-2">
                {acts.map((a) => (
                  <li key={a.key}>
                    <button
                      type="button"
                      onClick={() => openActivity(a.key)}
                      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-3 py-2.5 text-left hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1 font-medium">{a.title}</span>
                      {a.topic && <span className="text-xs text-muted-foreground">{a.topic}</span>}
                      <Badge variant="secondary">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                      {a.mode === 'test' && <Badge variant="info">Test</Badge>}
                      <Badge variant="outline">{a.cefr}</Badge>
                      <span className="w-32 text-right">
                        <ScoreChip progress={a.progress} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">English Course</h2>
          <p className="text-sm text-muted-foreground">Skill-based practice in pronunciation, rhythm, listening, reading, grammar and writing — at your own pace.</p>
        </div>
        <Button variant="outline" onClick={() => setView({ name: 'progress' })}>
          <BarChart3 className="mr-1.5 h-4 w-4" /> My progress
        </Button>
      </div>
      {levelFilter}
      {catalog.isPending && <p className="text-sm text-muted-foreground">Loading the course…</p>}
      {catalog.error && <p className="text-sm text-destructive">{catalog.error.message}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {tracks.map((track) => {
          const acts = track.units.flatMap((u) => u.activities).filter(matches);
          if (acts.length === 0) return null;
          const done = acts.filter((a) => (a.progress?.attempts ?? 0) > 0).length;
          const Icon = TRACK_ICON[track.key];
          return (
            <button
              key={track.key}
              type="button"
              onClick={() => setView({ name: 'track', key: track.key })}
              className="flex flex-col gap-3 rounded-card border border-hairline bg-card p-5 text-left transition-colors hover:border-brand"
            >
              <span className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-brand" />
                <span className="text-lg font-semibold">{track.title}</span>
              </span>
              <span className="text-sm text-muted-foreground">{track.description}</span>
              <span className="space-y-1">
                <span className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {track.units.length} units · {acts.length} activities
                  </span>
                  <span>{done} done</span>
                </span>
                <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full bg-brand" style={{ width: `${acts.length ? (done / acts.length) * 100 : 0}%` }} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
