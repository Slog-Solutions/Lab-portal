import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getActivity, hasActivity } from '@lab/shared/activities';
import { resolveDictionaryEnabled, type ActivityType } from '@lab/shared';
import { apiFetch } from '../../../lib/api-client';
import { queryKeys } from '../../../lib/query-keys';
import { GroupMonitorButton } from '../GroupMonitorButton';
import type { SessionSummary } from './session-draft';

function activityLabel(type: string | undefined): string {
  if (!type) return 'No activity';
  return hasActivity(type as ActivityType) ? getActivity(type as ActivityType).label : type;
}

/**
 * Sessions with their run controls (Arm -> Start <-> Pause -> End), the
 * teacher's listen-in per group and the Round Table monitor/review link.
 * `batchId` narrows it to one class — a class's own activity list.
 */
export function SessionList({
  batchId,
  emptyText = 'No sessions yet.',
  onlyActive = false,
}: {
  batchId?: string;
  emptyText?: string;
  /** Lab Control Console's "Ongoing Activities" view — hide ENDED sessions so
   * it only ever shows what the teacher can still act on right now. */
  onlyActive?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: allSessions, isError } = useQuery({
    queryKey: queryKeys.sessionsList(batchId),
    queryFn: () => apiFetch<SessionSummary[]>(batchId ? `/sessions?batchId=${encodeURIComponent(batchId)}` : '/sessions'),
  });
  const sessions = onlyActive ? allSessions?.filter((s) => s.state !== 'ENDED') : allSessions;

  const lifecycle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'arm' | 'start' | 'pause' | 'end' }) =>
      apiFetch(`/sessions/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });

  // Teacher control (spec §7) — per-group dictionary on/off, live.
  const dictionaryToggle = useMutation({
    mutationFn: ({ sessionId, groupId, enabled }: { sessionId: string; groupId: string; enabled: boolean }) =>
      apiFetch(`/sessions/${sessionId}/groups/${groupId}/dictionary`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });


  return (
    <div className="space-y-3">
      {sessions?.map((s) => (
        <article key={s.id} className="rounded-control border border-hairline bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-foreground">{s.title}</h3>
                <SessionStateBadge state={s.state} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {s.groups.length} group{s.groups.length === 1 ? '' : 's'} · {new Date(s.startedAt ?? s.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {s.state === 'DRAFT' && (
                <Button size="sm" onClick={() => lifecycle.mutate({ id: s.id, action: 'arm' })}>
                  Arm
                </Button>
              )}
              {(s.state === 'ARMED' || s.state === 'PAUSED') && (
                <Button size="sm" onClick={() => lifecycle.mutate({ id: s.id, action: 'start' })}>
                  <Play />
                  Start
                </Button>
              )}
              {s.state === 'RUNNING' && (
                <Button size="sm" variant="outline" onClick={() => lifecycle.mutate({ id: s.id, action: 'pause' })}>
                  <Pause />
                  Pause
                </Button>
              )}
              {s.state !== 'ENDED' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => lifecycle.mutate({ id: s.id, action: 'end' })}
                >
                  <Square />
                  End
                </Button>
              )}
            </div>
          </header>

          <ul className="divide-y divide-hairline border-t border-hairline">
            {s.groups.map((g) => {
              const names = (g.members ?? []).flatMap((m) => (m.student ? [m.student.fullName] : []));
              const dictionaryOn = g.activity
                ? resolveDictionaryEnabled(g.activity.type as ActivityType, g.activity.dictionaryEnabled)
                : null;
              return (
                <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-xs">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control bg-muted text-[11px] font-bold text-foreground">
                    {g.index}
                  </span>
                  <span className="font-medium text-foreground">{activityLabel(g.activity?.type)}</span>
                  {names.length > 0 && <span className="min-w-0 flex-1 truncate text-muted-foreground">{names.join(', ')}</span>}
                  {g.activity && (
                    <button
                      type="button"
                      title="Offline dictionary — click to toggle"
                      onClick={() => dictionaryToggle.mutate({ sessionId: s.id, groupId: g.id, enabled: !dictionaryOn })}
                      className={cn(
                        'ml-auto inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
                        dictionaryOn ? 'bg-brand-soft text-brand hover:bg-brand-soft/70' : 'bg-muted text-muted-foreground hover:bg-accent',
                      )}
                    >
                      <BookOpen className="h-3 w-3" aria-hidden />
                      Dictionary {dictionaryOn ? 'on' : 'off'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Ser 3 Teacher listens in on any group — except a vocabulary
              test's group, which has no media room at all (see
              SessionsService.arm's own skip), and Round Table, which gets
              its own dedicated monitor link below instead. */}
          {s.state !== 'DRAFT' && s.groups.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-hairline bg-muted/30 px-4 py-2.5">
              {s.groups
                .filter((g) => g.activity?.type !== 'ROUND_TABLE' && g.activity?.type !== 'VOCABULARY_TEST')
                .map((g) => (
                  <GroupMonitorButton key={g.id} groupId={g.id} label={`Group ${g.index}`} />
                ))}
              {s.groups.some((g) => g.activity?.type === 'ROUND_TABLE') && (
                <Button asChild size="sm" variant="secondary">
                  <Link to={`/sessions/${s.id}/round-table`}>
                    {s.state === 'ENDED' ? 'Round Table review' : 'Round Table monitor'}
                    <ArrowRight />
                  </Link>
                </Button>
              )}
              {/* SPEC-mcq-test-timed-reveal.md §7.3 — a vocabulary test group
                  is only ever created by TimedTestsService.launch, which
                  always links exerciseId; the live board is keyed by the
                  ActivityInstance id (activity.id), not the group id. */}
              {s.groups
                .filter((g) => g.activity?.type === 'VOCABULARY_TEST' && g.activity.id)
                .map((g) => (
                  <Button key={g.id} asChild size="sm" variant="secondary">
                    <Link to={`/tests/live/${g.activity!.id}`}>
                      Test board
                      <ArrowRight />
                    </Link>
                  </Button>
                ))}
            </div>
          )}
        </article>
      ))}
      {sessions?.length === 0 && (
        <p className="rounded-control border border-dashed border-input px-4 py-6 text-center text-xs text-muted-foreground">{emptyText}</p>
      )}
      {isError && <p className="text-xs text-destructive">Could not load sessions.</p>}
      {lifecycle.isError && (
        <p className="text-xs text-destructive">{lifecycle.error instanceof Error ? lifecycle.error.message : 'That action failed'}</p>
      )}
    </div>
  );
}

const STATE_STYLE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  ARMED: 'bg-status-info/10 text-status-info',
  RUNNING: 'bg-status-online/10 text-status-online',
  PAUSED: 'bg-status-pending/10 text-status-pending',
  ENDED: 'bg-muted text-muted-foreground',
};

function SessionStateBadge({ state }: { state: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-semibold', STATE_STYLE[state] ?? STATE_STYLE.DRAFT)}>
      {state === 'RUNNING' && <span className="h-1.5 w-1.5 rounded-full bg-status-online" aria-hidden />}
      {state.charAt(0) + state.slice(1).toLowerCase()}
    </span>
  );
}
