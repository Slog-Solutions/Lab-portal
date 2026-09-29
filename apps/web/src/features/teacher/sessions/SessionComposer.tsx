import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Circle, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
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


  // Class mode picks students (fixed batch); the Session Builder picks seats.
  const memberNoun = fixedBatchId ? 'Students' : 'Seats';
  const assignedCount = groups.reduce((n, g) => n + g.memberStationIds.length, 0);
  const activeGroupCount = groups.filter((g) => g.memberStationIds.length > 0).length;
  const checklist = [
    { ok: !!title.trim(), label: 'Session title' },
    ...(fixedBatchId ? [] : [{ ok: !!batchId, label: 'Class selected' }]),
    { ok: hasMembers, label: `${memberNoun} picked for at least one group` },
    ...(groups.some((g) => g.activityType === 'ROUND_TABLE') ? [{ ok: hasMembers && !invalidRoundTable, label: 'Round Table settings complete' }] : []),
  ];
  const canCreate = !!title && !!batchId && hasMembers && !createSession.isPending && !invalidRoundTable;

  const picker = (group: GroupDraft) => (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">
          {group.activityType === 'ROUND_TABLE' && group.participantAssignment === 'automatic' ? `${memberNoun} pool` : memberNoun}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">{group.memberStationIds.length} picked</span>
      </div>
      <MemberPicker
        group={group}
        groups={groups}
        candidates={candidates}
        picks={picks}
        emptyText={emptyText}
        onToggle={(stationId, pick) => toggleMember(group.index, stationId, pick)}
      />
    </div>
  );

  return (
    <div className="@container">
      <div className="grid gap-5 @4xl:grid-cols-[minmax(0,1fr)_280px]">
        {/* Form column */}
        <div className="min-w-0 space-y-5">
          <div className={cn('grid gap-4', !fixedBatchId && '@xl:grid-cols-[minmax(0,1fr)_240px]')}>
            <div>
              <FieldLabel htmlFor="session-title">Session title</FieldLabel>
              <Input id="session-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Unit 4 — group discussion" />
            </div>
            {!fixedBatchId && (
              <div>
                <FieldLabel htmlFor="session-batch">Class</FieldLabel>
                <NativeSelect id="session-batch" className="w-full" value={chosenBatchId} onChange={(e) => setChosenBatchId(e.target.value)}>
                  <option value="">Select batch…</option>
                  {batches?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>

          {groups.map((group) => (
            <section key={group.index} className="rounded-card border border-hairline bg-card">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline px-4 py-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-brand text-xs font-bold text-brand-ink">
                  {group.index}
                </span>
                <span className="text-sm font-semibold text-foreground">Group {group.index}</span>
                <NativeSelect
                  className="w-full @md:w-60"
                  aria-label={`Group ${group.index} activity`}
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
                >
                  {options.map((o) => (
                    <option key={o.type} value={o.type}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={group.dictionaryEnabled}
                    onChange={(e) => updateGroup(group.index, { dictionaryEnabled: e.target.checked, dictionaryEnabledTouched: true })}
                    className="h-4 w-4 accent-brand"
                  />
                  Allow dictionary
                </label>
                {groups.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    onClick={() => removeGroup(group.index)}
                  >
                    <Trash2 />
                    Remove
                  </Button>
                )}
              </header>

              <div className="space-y-5 p-4">
                {group.activityType === 'VOCABULARY_TEST' ? (
                  <div>
                    <FieldLabel>Word pairs</FieldLabel>
                    <Textarea
                      value={group.wordPairs}
                      onChange={(e) => updateGroup(group.index, { wordPairs: e.target.value })}
                      placeholder={'One per line: word=answer\ncat=gato\ndog=perro'}
                      rows={3}
                    />
                  </div>
                ) : group.activityType === 'MODEL_IMITATION' ? (
                  <div>
                    <FieldLabel>Master track</FieldLabel>
                    <NativeSelect
                      className="w-full"
                      aria-label="Master track"
                      value={group.masterTrackAssetId}
                      onChange={(e) => updateGroup(group.index, { masterTrackAssetId: e.target.value })}
                    >
                      <option value="">Select master track (audio)…</option>
                      {audioAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title ?? a.filename}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ) : group.activityType === 'CONFERENCE_INTERPRETING' ? (
                  <div className="grid gap-4 @xl:grid-cols-2">
                    <div>
                      <FieldLabel>Topic</FieldLabel>
                      <Input value={group.topic} onChange={(e) => updateGroup(group.index, { topic: e.target.value })} placeholder="Topic" />
                    </div>
                    <div>
                      <FieldLabel>Languages</FieldLabel>
                      <Input
                        value={group.languages}
                        onChange={(e) => updateGroup(group.index, { languages: e.target.value })}
                        placeholder="Comma-separated, e.g. fr, hi"
                      />
                    </div>
                  </div>
                ) : group.activityType === 'ROUND_TABLE' ? null : (
                  <div>
                    <FieldLabel>Scenario</FieldLabel>
                    <Input
                      value={group.topic}
                      onChange={(e) => updateGroup(group.index, { topic: e.target.value })}
                      placeholder="Scenario (optional)"
                    />
                  </div>
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
                  <div>
                    <FieldLabel>Roles</FieldLabel>
                    <p className="-mt-1 mb-2 text-xs text-muted-foreground">Anyone left unset joins as an observer.</p>
                    <ul className="divide-y divide-hairline rounded-control border border-hairline">
                      {group.memberStationIds.map((id) => {
                        const assigned = group.interpretingRoles[id] ?? { role: 'OBSERVER' as InterpretingRoleChoice, lang: '' };
                        return (
                          <li key={id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                            <span className="min-w-32 flex-1 truncate text-sm text-foreground">{labelOf(id)}</span>
                            <NativeSelect
                              className="w-48"
                              aria-label={`Role for ${labelOf(id)}`}
                              value={assigned.role}
                              onChange={(e) => updateInterpretingRole(group.index, id, { role: e.target.value as InterpretingRoleChoice })}
                            >
                              <option value="OBSERVER">Observer</option>
                              <option value="DELEGATE">Delegate (floor)</option>
                              <option value="INTERPRETER">Interpreter</option>
                            </NativeSelect>
                            {assigned.role === 'INTERPRETER' && (
                              <Input
                                value={assigned.lang}
                                onChange={(e) => updateInterpretingRole(group.index, id, { lang: e.target.value })}
                                placeholder="Language, e.g. fr"
                                className="w-36"
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          ))}

          <button
            type="button"
            onClick={addGroup}
            disabled={groups.length >= 6}
            className="flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-input py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input disabled:hover:text-muted-foreground"
          >
            <Plus className="h-4 w-4" />
            Add group ({groups.length}/6)
          </button>
        </div>

        {/* Summary column — beside the form when there is room, below it otherwise. */}
        <aside className="@4xl:sticky @4xl:top-[86px] @4xl:self-start">
          <div className="rounded-card border border-hairline bg-muted/40 p-4">
            <h3 className="text-sm font-semibold text-foreground">Summary</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Groups with members</dt>
                <dd className="font-semibold text-foreground tabular-nums">
                  {activeGroupCount} / {groups.length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{memberNoun} assigned</dt>
                <dd className="font-semibold text-foreground tabular-nums">{assignedCount}</dd>
              </div>
            </dl>

            <ul className="mt-4 space-y-2 border-t border-hairline pt-4">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-xs">
                  {item.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-status-online" aria-hidden />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
                  )}
                  <span className={item.ok ? 'text-foreground' : 'text-muted-foreground'}>{item.label}</span>
                  <span className="sr-only">{item.ok ? '(done)' : '(to do)'}</span>
                </li>
              ))}
            </ul>

            <Button
              className="mt-4 w-full"
              disabled={!canCreate}
              onClick={() => {
                setError(null);
                createSession.mutate();
              }}
            >
              {createSession.isPending ? 'Creating…' : 'Create session'}
            </Button>
            {error && (
              <p role="alert" className="mt-3 rounded-control bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-foreground">
      {children}
    </label>
  );
}

/** The member tiles shared by every activity type. For a Round Table with
 * automatic grouping this is the POOL that gets split when the session is
 * armed. A student picked earlier who has since moved or signed out keeps a
 * tile of their own (marked) so the pick can be seen and removed. */
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

  if (candidates.length === 0 && stale.length === 0) {
    return (
      <p className="rounded-control border border-dashed border-input px-3 py-4 text-center text-xs text-muted-foreground" data-testid="seat-picker">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2" data-testid="seat-picker">
      {candidates.map((c) => {
        const stationId = c.stationId;
        const selected = !!stationId && group.memberStationIds.includes(stationId) && !stale.includes(stationId);
        const otherGroup = stationId ? groups.find((g) => g.index !== group.index && g.memberStationIds.includes(stationId)) : undefined;
        const disabled = !stationId || !!otherGroup;
        const note = c.disabledReason ?? (otherGroup ? `In group ${otherGroup.index}` : c.detail);
        return (
          <button
            key={c.key}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            title={c.disabledReason}
            onClick={() => stationId && onToggle(stationId, c.studentId ? { studentId: c.studentId, label: c.label } : undefined)}
            className={cn(
              'relative flex min-h-[52px] flex-col justify-center rounded-control border px-3 py-2 text-left transition-colors',
              selected
                ? 'border-brand bg-brand text-brand-ink'
                : disabled
                  ? 'cursor-not-allowed border-dashed border-input bg-transparent text-muted-foreground'
                  : 'border-input bg-card text-foreground hover:border-brand/50 hover:bg-accent',
            )}
          >
            <span className="truncate pr-5 text-sm font-semibold">{c.label}</span>
            {note && <span className={cn('truncate text-xs', selected ? 'text-brand-ink-muted' : 'text-muted-foreground')}>{note}</span>}
            {selected && <Check className="absolute right-2.5 top-2.5 h-3.5 w-3.5" aria-hidden />}
          </button>
        );
      })}
      {stale.map((id) => (
        <button
          key={`stale-${id}`}
          type="button"
          onClick={() => onToggle(id)}
          title="No longer signed in at that computer — click to remove"
          className="relative flex min-h-[52px] flex-col justify-center rounded-control border border-status-pending/50 bg-status-pending/10 px-3 py-2 text-left text-foreground transition-colors hover:bg-status-pending/20"
        >
          <span className="truncate pr-5 text-sm font-semibold">{picks[id]?.label ?? `Seat ${id.slice(0, 8)}`}</span>
          <span className="truncate text-xs text-muted-foreground">Moved — click to remove</span>
          <X className="absolute right-2.5 top-2.5 h-3.5 w-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
