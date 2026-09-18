import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { seatLabel, type StationStatusRow } from '@lab/shared';
import { apiFetch } from '../../lib/api-client';
import { mediaAssetsApi } from '../../lib/media-assets-api';
import { GroupMonitorButton } from './GroupMonitorButton';

interface Batch {
  id: string;
  name: string;
}

interface SessionSummary {
  id: string;
  title: string;
  state: string;
  groups: Array<{ id: string; index: number }>;
}

/** Composable here without leaving the builder — every registered
 * ActivityType now has either a player or (self-study) its own dedicated
 * browsing surface; see packages/shared/src/activities for the full
 * registry and StudyLibraryPanel for why SELF_STUDY isn't listed here
 * (it's reached directly from the student console, not scheduled into a
 * session slot). */
type BuilderActivityType = 'VOCABULARY_TEST' | 'ROUND_TABLE' | 'TELEPHONE' | 'MODEL_IMITATION' | 'CONFERENCE_INTERPRETING';

type InterpretingRoleChoice = 'INTERPRETER' | 'DELEGATE' | 'OBSERVER';

interface GroupDraft {
  index: number;
  activityType: BuilderActivityType;
  topic: string; // ROUND_TABLE topic / TELEPHONE scenario / CONFERENCE_INTERPRETING topic
  wordPairs: string; // VOCABULARY_TEST raw textarea: "word=answer" per line
  memberStationIds: string[];
  chairmanStationId: string; // ROUND_TABLE only — '' means none picked yet
  masterTrackAssetId: string; // MODEL_IMITATION only
  languages: string; // CONFERENCE_INTERPRETING only — comma-separated
  // CONFERENCE_INTERPRETING only — per-member role + language, keyed by stationId.
  interpretingRoles: Record<string, { role: InterpretingRoleChoice; lang: string }>;
}

function emptyGroup(index: number): GroupDraft {
  return {
    index,
    activityType: 'ROUND_TABLE',
    topic: '',
    wordPairs: '',
    memberStationIds: [],
    chairmanStationId: '',
    masterTrackAssetId: '',
    languages: '',
    interpretingRoles: {},
  };
}

function buildActivityConfig(group: GroupDraft): unknown {
  switch (group.activityType) {
    case 'VOCABULARY_TEST':
      return {
        shuffleItems: true,
        items: group.wordPairs
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [prompt, answer] = line.split('=').map((s) => s.trim());
            return { prompt: prompt ?? line, answer: answer ?? '' };
          }),
      };
    case 'ROUND_TABLE':
      return { topic: group.topic || 'Untitled discussion', chairmanAssignment: 'manual', micRequestQueueEnabled: true };
    case 'TELEPHONE':
      return { scenario: group.topic || undefined, maxDurationSec: 600 };
    case 'MODEL_IMITATION':
      return { masterTrackAssetId: group.masterTrackAssetId, pausePoints: [], allowManualPause: true };
    case 'CONFERENCE_INTERPRETING':
      return {
        topic: group.topic || 'Untitled conference',
        languages: group.languages
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean),
        roles: group.memberStationIds
          .filter((id) => group.interpretingRoles[id])
          .map((id) => ({ stationId: id, role: group.interpretingRoles[id]!.role, lang: group.interpretingRoles[id]!.lang || undefined })),
      };
  }
}

/**
 * Teacher-facing composer for Annexure-I's "six independent, simultaneous
 * sessions" — the UI on top of the SessionsService state machine that
 * was built and verified live in the previous pass (create → arm →
 * start → pause → end, real LiveKit rooms per group).
 */
export function SessionBuilderPage() {
  const queryClient = useQueryClient();
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => apiFetch<Batch[]>('/sessions/batches') });
  const { data: stations } = useQuery({
    queryKey: ['stations', 'status-board'],
    queryFn: () => apiFetch<StationStatusRow[]>('/control/status-board'),
    refetchInterval: 10_000,
  });
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => apiFetch<SessionSummary[]>('/sessions') });
  const { data: mediaAssets } = useQuery({ queryKey: ['media-assets'], queryFn: mediaAssetsApi.list });
  const audioAssets = (mediaAssets ?? []).filter((a) => a.kind === 'audio');

  const [title, setTitle] = useState('');
  const [batchId, setBatchId] = useState('');
  const [groups, setGroups] = useState<GroupDraft[]>([emptyGroup(1)]);
  const [error, setError] = useState<string | null>(null);

  const availableStations = (stations ?? []).filter((s) => s.seatNo && s.seatNo !== 1); // seat 1 is the teacher

  const createSession = useMutation({
    mutationFn: () =>
      apiFetch('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          title,
          batchId,
          groups: groups
            .filter((g) => g.memberStationIds.length > 0)
            .map((g) => ({
              index: g.index,
              activityType: g.activityType,
              activityConfig: buildActivityConfig(g),
              memberStationIds: g.memberStationIds,
              chairmanStationId:
                g.activityType === 'ROUND_TABLE' && g.chairmanStationId ? g.chairmanStationId : undefined,
            })),
        }),
      }),
    onSuccess: () => {
      setTitle('');
      setGroups([emptyGroup(1)]);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create session'),
  });

  const lifecycle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'arm' | 'start' | 'pause' | 'end' }) =>
      apiFetch(`/sessions/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  function updateGroup(index: number, patch: Partial<GroupDraft>): void {
    setGroups((prev) => prev.map((g) => (g.index === index ? { ...g, ...patch } : g)));
  }

  function toggleMember(groupIndex: number, stationId: string): void {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.index !== groupIndex) {
          // A station can only belong to one group in the same session.
          if (!g.memberStationIds.includes(stationId)) return g;
          const memberStationIds = g.memberStationIds.filter((id) => id !== stationId);
          return { ...g, memberStationIds, chairmanStationId: g.chairmanStationId === stationId ? '' : g.chairmanStationId };
        }
        const has = g.memberStationIds.includes(stationId);
        const memberStationIds = has ? g.memberStationIds.filter((id) => id !== stationId) : [...g.memberStationIds, stationId];
        // Removing the current chairman from their own group clears the pick.
        const chairmanStationId = has && g.chairmanStationId === stationId ? '' : g.chairmanStationId;
        return { ...g, memberStationIds, chairmanStationId };
      }),
    );
  }

  function updateInterpretingRole(groupIndex: number, stationId: string, patch: Partial<{ role: InterpretingRoleChoice; lang: string }>): void {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.index !== groupIndex) return g;
        const current = g.interpretingRoles[stationId] ?? { role: 'OBSERVER' as InterpretingRoleChoice, lang: '' };
        return { ...g, interpretingRoles: { ...g.interpretingRoles, [stationId]: { ...current, ...patch } } };
      }),
    );
  }

  function addGroup(): void {
    if (groups.length >= 6) return; // Annexure-I Ser 1: max six sessions/groups
    setGroups((prev) => [...prev, emptyGroup(Math.max(...prev.map((g) => g.index)) + 1)]);
  }

  function removeGroup(index: number): void {
    setGroups((prev) => (prev.length > 1 ? prev.filter((g) => g.index !== index) : prev));
  }

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-50">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Session Builder</h1>
        <Link to="/dashboard" className="text-sm text-sky-400 hover:underline">
          ← Lab Control Console
        </Link>
      </header>

      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">New Session</h2>
        <div className="mb-4 flex gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Session title"
            className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm"
          />
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm"
          >
            <option value="">Select batch…</option>
            {batches?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.index} className="rounded-md border border-slate-700 bg-slate-950 p-3">
              <div className="mb-2 flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-400">Group {group.index}</span>
                <select
                  value={group.activityType}
                  onChange={(e) => updateGroup(group.index, { activityType: e.target.value as BuilderActivityType })}
                  className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                >
                  <option value="ROUND_TABLE">Round Table Discussion</option>
                  <option value="VOCABULARY_TEST">Vocabulary Test</option>
                  <option value="TELEPHONE">Telephone Activity</option>
                  <option value="MODEL_IMITATION">Model Imitation</option>
                  <option value="CONFERENCE_INTERPRETING">Conference Interpreting</option>
                </select>
                {groups.length > 1 && (
                  <button type="button" onClick={() => removeGroup(group.index)} className="ml-auto text-xs text-red-400 hover:underline">
                    Remove
                  </button>
                )}
              </div>

              {group.activityType === 'VOCABULARY_TEST' ? (
                <textarea
                  value={group.wordPairs}
                  onChange={(e) => updateGroup(group.index, { wordPairs: e.target.value })}
                  placeholder={'One per line: word=answer\ncat=gato\ndog=perro'}
                  rows={3}
                  className="mb-2 w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                />
              ) : group.activityType === 'MODEL_IMITATION' ? (
                <select
                  value={group.masterTrackAssetId}
                  onChange={(e) => updateGroup(group.index, { masterTrackAssetId: e.target.value })}
                  className="mb-2 w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                >
                  <option value="">Select master track (audio)…</option>
                  {audioAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title ?? a.filename}
                    </option>
                  ))}
                </select>
              ) : group.activityType === 'CONFERENCE_INTERPRETING' ? (
                <div className="mb-2 flex gap-2">
                  <input
                    value={group.topic}
                    onChange={(e) => updateGroup(group.index, { topic: e.target.value })}
                    placeholder="Topic"
                    className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                  />
                  <input
                    value={group.languages}
                    onChange={(e) => updateGroup(group.index, { languages: e.target.value })}
                    placeholder="Languages, comma-separated (e.g. fr, hi)"
                    className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                  />
                </div>
              ) : (
                <input
                  value={group.topic}
                  onChange={(e) => updateGroup(group.index, { topic: e.target.value })}
                  placeholder={group.activityType === 'ROUND_TABLE' ? 'Discussion topic' : 'Scenario (optional)'}
                  className="mb-2 w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                />
              )}

              <div className="flex flex-wrap gap-1.5">
                {availableStations.map((s) => {
                  const selected = group.memberStationIds.includes(s.stationId);
                  const takenElsewhere = groups.some((g) => g.index !== group.index && g.memberStationIds.includes(s.stationId));
                  return (
                    <button
                      key={s.stationId}
                      type="button"
                      disabled={takenElsewhere}
                      onClick={() => toggleMember(group.index, s.stationId)}
                      className={`rounded px-2 py-0.5 text-xs ${
                        selected ? 'bg-sky-700 text-white' : takenElsewhere ? 'bg-slate-900 text-slate-700' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      Seat {seatLabel(s.seatNo)}
                    </button>
                  );
                })}
                {availableStations.length === 0 && <span className="text-xs text-slate-600">No stations online yet.</span>}
              </div>

              {group.activityType === 'ROUND_TABLE' && group.memberStationIds.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-xs text-slate-400">Chairman:</label>
                  <select
                    value={group.chairmanStationId}
                    onChange={(e) => updateGroup(group.index, { chairmanStationId: e.target.value })}
                    className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                  >
                    <option value="">None assigned</option>
                    {group.memberStationIds.map((id) => {
                      const station = availableStations.find((s) => s.stationId === id);
                      return (
                        <option key={id} value={id}>
                          Seat {station ? seatLabel(station.seatNo) : id.slice(0, 8)}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {group.activityType === 'CONFERENCE_INTERPRETING' && group.memberStationIds.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-slate-400">Roles (default Observer if unset):</p>
                  {group.memberStationIds.map((id) => {
                    const station = availableStations.find((s) => s.stationId === id);
                    const assigned = group.interpretingRoles[id] ?? { role: 'OBSERVER' as InterpretingRoleChoice, lang: '' };
                    return (
                      <div key={id} className="flex items-center gap-2">
                        <span className="w-16 text-xs text-slate-500">Seat {station ? seatLabel(station.seatNo) : id.slice(0, 8)}</span>
                        <select
                          value={assigned.role}
                          onChange={(e) => updateInterpretingRole(group.index, id, { role: e.target.value as InterpretingRoleChoice })}
                          className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                        >
                          <option value="OBSERVER">Observer</option>
                          <option value="DELEGATE">Delegate (floor)</option>
                          <option value="INTERPRETER">Interpreter</option>
                        </select>
                        {assigned.role === 'INTERPRETER' && (
                          <input
                            value={assigned.lang}
                            onChange={(e) => updateInterpretingRole(group.index, id, { lang: e.target.value })}
                            placeholder="lang (e.g. fr)"
                            className="w-24 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={addGroup}
            disabled={groups.length >= 6}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 disabled:opacity-40"
          >
            + Add Group ({groups.length}/6)
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              createSession.mutate();
            }}
            disabled={!title || !batchId || createSession.isPending}
            className="ml-auto rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Create Session
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Sessions</h2>
        <div className="space-y-2">
          {sessions?.map((s) => (
            <div key={s.id} className="rounded-md border border-slate-800 bg-slate-900 px-4 py-2">
              <div className="flex items-center gap-3">
                <span className="font-medium">{s.title}</span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{s.state}</span>
                <span className="text-xs text-slate-500">{s.groups.length} group(s)</span>
                <div className="ml-auto flex gap-1.5">
                  {s.state === 'DRAFT' && (
                    <SessionActionButton label="Arm" onClick={() => lifecycle.mutate({ id: s.id, action: 'arm' })} />
                  )}
                  {(s.state === 'ARMED' || s.state === 'PAUSED') && (
                    <SessionActionButton label="Start" onClick={() => lifecycle.mutate({ id: s.id, action: 'start' })} />
                  )}
                  {s.state === 'RUNNING' && (
                    <SessionActionButton label="Pause" onClick={() => lifecycle.mutate({ id: s.id, action: 'pause' })} />
                  )}
                  {s.state !== 'ENDED' && (
                    <SessionActionButton label="End" tone="danger" onClick={() => lifecycle.mutate({ id: s.id, action: 'end' })} />
                  )}
                </div>
              </div>
              {/* Ser 3 "Teacher listens in on any group, can join" — rooms
                  only exist once a session leaves DRAFT (SessionsService.arm). */}
              {s.state !== 'DRAFT' && s.groups.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-800 pt-2">
                  {s.groups.map((g) => (
                    <GroupMonitorButton key={g.id} groupId={g.id} label={`Group ${g.index}`} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {sessions?.length === 0 && <p className="text-sm text-slate-600">No sessions yet.</p>}
        </div>
      </section>
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
