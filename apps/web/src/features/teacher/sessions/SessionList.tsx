import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
        <div key={s.id} className="rounded-2xl border border-[rgba(20,21,15,0.08)] bg-[#F4F4EF] p-4 text-[#14150F]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="font-semibold text-sm text-[#14150F]">{s.title}</span>
              <span className="rounded-full bg-[#17181A] px-2.5 py-0.5 text-[11px] font-medium text-[#F5F5F0]">
                {s.state}
              </span>
              <span className="text-xs text-[#6E7066]">
                {s.groups.length} group(s) · {new Date(s.startedAt ?? s.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="flex gap-1.5">
              {s.state === 'DRAFT' && <SessionActionButton label="Arm" onClick={() => lifecycle.mutate({ id: s.id, action: 'arm' })} />}
              {(s.state === 'ARMED' || s.state === 'PAUSED') && (
                <SessionActionButton label="Start" onClick={() => lifecycle.mutate({ id: s.id, action: 'start' })} />
              )}
              {s.state === 'RUNNING' && <SessionActionButton label="Pause" onClick={() => lifecycle.mutate({ id: s.id, action: 'pause' })} />}
              {s.state !== 'ENDED' && (
                <SessionActionButton label="End" tone="danger" onClick={() => lifecycle.mutate({ id: s.id, action: 'end' })} />
              )}
            </div>
          </div>
          <ul className="mt-2 space-y-1">
            {s.groups.map((g) => {
              const names = (g.members ?? []).flatMap((m) => (m.student ? [m.student.fullName] : []));
              const dictionaryOn = g.activity
                ? resolveDictionaryEnabled(g.activity.type as ActivityType, g.activity.dictionaryEnabled)
                : null;
              return (
                <li key={g.id} className="flex flex-wrap items-center gap-1.5 text-xs text-[#6E7066]">
                  <span>
                    Group {g.index} · <span className="font-medium text-[#14150F]">{activityLabel(g.activity?.type)}</span>
                    {names.length > 0 && ` · ${names.join(', ')}`}
                  </span>
                  {g.activity && (
                    <button
                      type="button"
                      title="Offline dictionary — click to toggle"
                      onClick={() => dictionaryToggle.mutate({ sessionId: s.id, groupId: g.id, enabled: !dictionaryOn })}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${dictionaryOn ? 'bg-[#DFE2D6] text-[#14150F]' : 'bg-[#E5E8DC] text-[#6E7066]'}`}
                    >
                      Dictionary: {dictionaryOn ? 'On' : 'Off'}
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
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[rgba(20,21,15,0.08)] pt-2.5">
              {s.groups
                .filter((g) => g.activity?.type !== 'ROUND_TABLE' && g.activity?.type !== 'VOCABULARY_TEST')
                .map((g) => (
                  <GroupMonitorButton key={g.id} groupId={g.id} label={`Group ${g.index}`} />
                ))}
              {s.groups.some((g) => g.activity?.type === 'ROUND_TABLE') && (
                <Link
                  to={`/sessions/${s.id}/round-table`}
                  className="rounded-full bg-[#17181A] px-3 py-1 text-xs font-semibold text-[#F5F5F0] hover:bg-black"
                >
                  {s.state === 'ENDED' ? 'Round Table review' : 'Round Table monitor'}
                </Link>
              )}
              {/* SPEC-mcq-test-timed-reveal.md §7.3 — a vocabulary test group
                  is only ever created by TimedTestsService.launch, which
                  always links exerciseId; the live board is keyed by the
                  ActivityInstance id (activity.id), not the group id. */}
              {s.groups
                .filter((g) => g.activity?.type === 'VOCABULARY_TEST' && g.activity.id)
                .map((g) => (
                  <Link
                    key={g.id}
                    to={`/tests/live/${g.activity!.id}`}
                    className="rounded-full bg-[#17181A] px-3 py-1 text-xs font-semibold text-[#F5F5F0] hover:bg-black"
                  >
                    Test board
                  </Link>
                ))}
            </div>
          )}
        </div>
      ))}
      {sessions?.length === 0 && <p className="text-xs text-[#6E7066]">{emptyText}</p>}
      {isError && <p className="text-xs text-[#C9503F]">Could not load sessions.</p>}
      {lifecycle.isError && (
        <p className="text-xs text-[#C9503F]">{lifecycle.error instanceof Error ? lifecycle.error.message : 'That action failed'}</p>
      )}
    </div>
  );
}

function SessionActionButton({ label, onClick, tone }: { label: string; onClick: () => void; tone?: 'danger' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${tone === 'danger' ? 'bg-[#C9503F] text-white hover:opacity-90' : 'bg-[#17181A] text-[#F5F5F0] hover:bg-black'}`}
    >
      {label}
    </button>
  );
}
