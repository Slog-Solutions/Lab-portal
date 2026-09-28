import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api-client';
import { mediaAssetsApi } from '../../../lib/media-assets-api';
import { queryKeys } from '../../../lib/query-keys';
import { RoundTableAuthoring, validateRoundTableForm } from '../round-table/RoundTableAuthoring';
import {
  ACTIVITY_OPTIONS,
  buildActivityConfig,
  defaultDictionaryEnabled,
  emptyGroup,
  type BuilderActivityType,
  type GroupDraft,
  type InterpretingRoleChoice,
  type MemberCandidate,
  type StudentPick,
} from './session-draft';

/**
 * The "New Session" form: a title, up to six groups, each running one
 * activity with the members picked for it. Used twice:
 *  - the Session Builder (seats, any class chosen from a dropdown), and
 *  - a class's own page (that class fixed, its signed-in STUDENTS picked).
 * Either way a pick is a stationId underneath — the live engine delivers to
 * seats. Picking students also sends `expectedStudents`, so the server can
 * refuse if someone moved or signed out between the pick and Create.
 */
export function SessionComposer({
  batchId: fixedBatchId,
  batches,
  candidates,
  activityTypes = ACTIVITY_OPTIONS.map((o) => o.type),
  emptyText,
  initialGroups,
}: {
  /** A fixed class; when absent a class dropdown is shown (from `batches`). */
  batchId?: string;
  batches?: Array<{ id: string; name: string }>;
  candidates: MemberCandidate[];
  activityTypes?: BuilderActivityType[];
  /** Shown in the picker when there is nobody to pick. */
  emptyText: string;
  /** Seeds group 1 (or more) instead of starting from a single empty group —
   * e.g. seats a teacher already selected on the Lab Control Console. */
  initialGroups?: GroupDraft[];
}) {
  const queryClient = useQueryClient();
  const { data: mediaAssets } = useQuery({ queryKey: queryKeys.mediaAssets, queryFn: mediaAssetsApi.list });
  const audioAssets = (mediaAssets ?? []).filter((a) => a.kind === 'audio');
  const options = ACTIVITY_OPTIONS.filter((o) => activityTypes.includes(o.type));
  const defaultType = options[0]?.type ?? 'ROUND_TABLE';

  const [title, setTitle] = useState('');
  const [chosenBatchId, setChosenBatchId] = useState('');
  const batchId = fixedBatchId ?? chosenBatchId;
  const [groups, setGroups] = useState<GroupDraft[]>(initialGroups ?? [emptyGroup(1, defaultType)]);
  // stationId -> the student it was picked for (student picking only).
  const [picks, setPicks] = useState<Record<string, StudentPick>>({});
  const [error, setError] = useState<string | null>(null);

  const labelOf = (stationId: string): string =>
    candidates.find((c) => c.stationId === stationId)?.label ?? picks[stationId]?.label ?? `Seat ${stationId.slice(0, 8)}`;
  // A Round Table with members picked must satisfy the same rules the server enforces on create.
  const invalidRoundTable = groups.some((g) => g.activityType === 'ROUND_TABLE' && g.memberStationIds.length > 0 && validateRoundTableForm(g).length > 0);
  const hasMembers = groups.some((g) => g.memberStationIds.length > 0);

  const createSession = useMutation({
    mutationFn: () => {
      const picked = new Set(groups.flatMap((g) => g.memberStationIds));
      const expected = Object.fromEntries(
        Object.entries(picks)
          .filter(([stationId]) => picked.has(stationId))
          .map(([stationId, p]) => [stationId, p.studentId]),
      );
      return apiFetch('/sessions', {
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
                g.activityType === 'ROUND_TABLE' && g.chairmanAssignment === 'manual' && g.chairmanStationId ? g.chairmanStationId : undefined,
              // Omitted (not false) when the teacher never touched the
              // checkbox — the server then applies the activity type's own
              // default (spec §7) rather than freezing today's default in.
              dictionaryEnabled: g.dictionaryEnabledTouched ? g.dictionaryEnabled : undefined,
            })),
          expectedStudents: Object.keys(expected).length > 0 ? expected : undefined,
        }),
      });
    },
    onSuccess: () => {
      setTitle('');
      setGroups([emptyGroup(1, defaultType)]);
      setPicks({});
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      // Someone may have moved or signed out — show the current seats.
      void queryClient.invalidateQueries({ queryKey: queryKeys.stationsStatusBoard });
    },
  });

  function updateGroup(index: number, patch: Partial<GroupDraft>): void {
    setGroups((prev) => prev.map((g) => (g.index === index ? { ...g, ...patch } : g)));
  }

  function toggleMember(groupIndex: number, stationId: string, pick?: StudentPick): void {
    const inGroup = !!groups.find((g) => g.index === groupIndex)?.memberStationIds.includes(stationId);
    const existing = picks[stationId];
    if (inGroup && pick && existing && existing.studentId !== pick.studentId) {
      // Someone else now sits where the earlier pick was: the seat stays in
      // the group, picked for the student who is actually there.
      setPicks((prev) => ({ ...prev, [stationId]: pick }));
      return;
    }
    const adding = !inGroup;
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
    setPicks((prev) => {
      const next = { ...prev };
      if (adding && pick) next[stationId] = pick;
      else if (!adding) delete next[stationId];
      return next;
    });
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
    setGroups((prev) => [...prev, emptyGroup(Math.max(...prev.map((g) => g.index)) + 1, defaultType)]);
  }

  function removeGroup(index: number): void {
    const removed = groups.find((g) => g.index === index);
    setGroups((prev) => (prev.length > 1 ? prev.filter((g) => g.index !== index) : prev));
    if (removed && groups.length > 1) {
      setPicks((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !removed.memberStationIds.includes(id))));
    }
  }

  const picker = (group: GroupDraft) => (
    <MemberPicker
      group={group}
      groups={groups}
      candidates={candidates}
      picks={picks}
      emptyText={emptyText}
      onToggle={(stationId, pick) => toggleMember(group.index, stationId, pick)}
    />
  );

  return (
    <div>
      <div className="mb-4 flex gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Session title"
          className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm"
        />
        {!fixedBatchId && (
          <select
            value={chosenBatchId}
            onChange={(e) => setChosenBatchId(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm"
          >
            <option value="">Select batch…</option>
            {batches?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.index} className="rounded-md border border-slate-700 bg-slate-950 p-3">
            <div className="mb-2 flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-400">Group {group.index}</span>
              <select
                value={group.activityType}
                onChange={(e) => {
                  const activityType = e.target.value as BuilderActivityType;
                  updateGroup(group.index, {
                    activityType,
                    // Follows the new type's own default until the teacher
                    // explicitly touches the checkbox below (session-draft.ts).
                    ...(group.dictionaryEnabledTouched ? {} : { dictionaryEnabled: defaultDictionaryEnabled(activityType) }),
                  });
                }}
                className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
              >
                {options.map((o) => (
                  <option key={o.type} value={o.type}>
                    {o.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={group.dictionaryEnabled}
                  onChange={(e) => updateGroup(group.index, { dictionaryEnabled: e.target.checked, dictionaryEnabledTouched: true })}
                />
                Allow dictionary
              </label>
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
            ) : group.activityType === 'ROUND_TABLE' ? null : (
              <input
                value={group.topic}
                onChange={(e) => updateGroup(group.index, { topic: e.target.value })}
                placeholder="Scenario (optional)"
                className="mb-2 w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
              />
            )}

            {group.activityType === 'ROUND_TABLE' ? (
              <RoundTableAuthoring
                form={group}
                onChange={(patch) => updateGroup(group.index, patch)}
                seatName={labelOf}
                otherGroupCount={groups.length - 1}
              >
                {picker(group)}
              </RoundTableAuthoring>
            ) : (
              picker(group)
            )}

            {group.activityType === 'CONFERENCE_INTERPRETING' && group.memberStationIds.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <p className="text-xs text-slate-400">Roles (default Observer if unset):</p>
                {group.memberStationIds.map((id) => {
                  const assigned = group.interpretingRoles[id] ?? { role: 'OBSERVER' as InterpretingRoleChoice, lang: '' };
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <span className="w-32 truncate text-xs text-slate-500">{labelOf(id)}</span>
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
          disabled={!title || !batchId || !hasMembers || createSession.isPending || invalidRoundTable}
          className="ml-auto rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Create Session
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

/** The member buttons shared by every activity type. For a Round Table with
 * automatic grouping this is the POOL that gets split when the session is
 * armed. A student picked earlier who has since moved or signed out keeps a
 * chip of their own (marked) so the pick can be seen and removed. */
function MemberPicker({
  group,
  groups,
  candidates,
  picks,
  emptyText,
  onToggle,
}: {
  group: GroupDraft;
  groups: GroupDraft[];
  candidates: MemberCandidate[];
  picks: Record<string, StudentPick>;
  emptyText: string;
  onToggle: (stationId: string, pick?: StudentPick) => void;
}) {
  const stale = group.memberStationIds.filter((id) => {
    const pick = picks[id];
    const candidate = candidates.find((c) => c.stationId === id);
    return !candidate || (pick && candidate.studentId !== pick.studentId);
  });
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="seat-picker">
      {candidates.map((c) => {
        const stationId = c.stationId;
        const selected = !!stationId && group.memberStationIds.includes(stationId) && !stale.includes(stationId);
        const takenElsewhere = !!stationId && groups.some((g) => g.index !== group.index && g.memberStationIds.includes(stationId));
        const disabled = !stationId || takenElsewhere;
        return (
          <button
            key={c.key}
            type="button"
            disabled={disabled}
            title={c.disabledReason}
            onClick={() => stationId && onToggle(stationId, c.studentId ? { studentId: c.studentId, label: c.label } : undefined)}
            className={`rounded px-2 py-0.5 text-xs ${
              selected ? 'bg-sky-700 text-white' : disabled ? 'bg-slate-900 text-slate-600' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {c.label}
            {(c.disabledReason ?? c.detail) && (
              <span className={selected ? 'text-sky-200' : 'text-slate-500'}> · {c.disabledReason ?? c.detail}</span>
            )}
          </button>
        );
      })}
      {stale.map((id) => (
        <button
          key={`stale-${id}`}
          type="button"
          onClick={() => onToggle(id)}
          title="No longer signed in at that computer — click to remove"
          className="rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-100"
        >
          {picks[id]?.label ?? `Seat ${id.slice(0, 8)}`} · moved ✕
        </button>
      ))}
      {candidates.length === 0 && <span className="text-xs text-slate-600">{emptyText}</span>}
    </div>
  );
}
