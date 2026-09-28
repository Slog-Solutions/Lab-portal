import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getActivity, hasActivity } from '@lab/shared/activities';
import type { ActivityType } from '@lab/shared';
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

  return (
    <div className="space-y-2">
      {sessions?.map((s) => (
        <div key={s.id} className="rounded-md border border-slate-800 bg-slate-900 px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="font-medium">{s.title}</span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{s.state}</span>
            <span className="text-xs text-slate-500">
              {s.groups.length} group(s) · {new Date(s.startedAt ?? s.createdAt).toLocaleDateString()}
            </span>
            <div className="ml-auto flex gap-1.5">
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
          <ul className="mt-1 space-y-0.5">
            {s.groups.map((g) => {
              const names = (g.members ?? []).flatMap((m) => (m.student ? [m.student.fullName] : []));
              return (
                <li key={g.id} className="text-xs text-slate-500">
                  Group {g.index} · <span className="text-slate-300">{activityLabel(g.activity?.type)}</span>
                  {names.length > 0 && ` · ${names.join(', ')}`}
                </li>
              );
            })}
          </ul>
          {/* Ser 3 "Teacher listens in on any group, can join" — rooms
              only exist once a session leaves DRAFT (SessionsService.arm). */}
          {s.state !== 'DRAFT' && s.groups.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-800 pt-2">
              {/* A Round Table group is monitored on its own page: there the teacher
                  is visible to the group's students ("Teacher is listening"), which
                  this generic hidden listen-in deliberately is not. */}
              {s.groups
                .filter((g) => g.activity?.type !== 'ROUND_TABLE')
                .map((g) => (
                  <GroupMonitorButton key={g.id} groupId={g.id} label={`Group ${g.index}`} />
                ))}
              {s.groups.some((g) => g.activity?.type === 'ROUND_TABLE') && (
                <Link
                  to={`/sessions/${s.id}/round-table`}
                  className="rounded-md bg-emerald-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  {s.state === 'ENDED' ? 'Round Table review' : 'Round Table monitor'}
                </Link>
              )}
            </div>
          )}
        </div>
      ))}
      {sessions?.length === 0 && <p className="text-sm text-slate-600">{emptyText}</p>}
      {isError && <p className="text-sm text-red-400">Could not load sessions.</p>}
      {lifecycle.isError && (
        <p className="text-sm text-red-400">{lifecycle.error instanceof Error ? lifecycle.error.message : 'That action failed'}</p>
      )}
    </div>
  );
}

function SessionActionButton({ label, onClick, tone }: { label: string; onClick: () => void; tone?: 'danger' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium text-white ${tone === 'danger' ? 'bg-red-800 hover:bg-red-700' : 'bg-sky-700 hover:bg-sky-600'}`}
    >
      {label}
    </button>
  );
}
