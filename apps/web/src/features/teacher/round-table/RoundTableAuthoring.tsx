import { useId, type ReactNode } from 'react';
import { MAX_SESSION_GROUPS, previewGroupSizes, validateRoundTableSetup } from '@lab/shared/activities';

/** The flat form state of one Round Table group in the Session Builder. */
export interface RoundTableForm {
  topic: string;
  /** The seats picked in the builder. For automatic grouping this is the POOL. */
  memberStationIds: string[];
  chairmanStationId: string;
  participantAssignment: 'manual' | 'automatic';
  targetGroupSize: number;
  chairmanAssignment: 'manual' | 'automatic';
  chairmanStrategy: 'random' | 'rotate';
  rotateEverySec: number;
  micRequestQueueEnabled: boolean;
  /** Seconds, or '' for no limit. */
  maxTurnSec: string;
}

export const ROUND_TABLE_DEFAULTS = {
  participantAssignment: 'manual',
  targetGroupSize: 4,
  chairmanAssignment: 'manual',
  chairmanStrategy: 'random',
  rotateEverySec: 300,
  micRequestQueueEnabled: true,
  maxTurnSec: '',
} as const satisfies Partial<RoundTableForm>;

/** The `activityConfig` the API expects (validated again server-side). */
export function roundTableConfigFromForm(f: RoundTableForm): unknown {
  const maxTurn = Number.parseInt(f.maxTurnSec, 10);
  return {
    topic: f.topic.trim(),
    participantAssignment: f.participantAssignment,
    targetGroupSize: f.participantAssignment === 'automatic' ? f.targetGroupSize : undefined,
    chairmanAssignment: f.chairmanAssignment,
    chairmanStrategy: f.chairmanStrategy,
    rotateEverySec: f.chairmanAssignment === 'automatic' && f.chairmanStrategy === 'rotate' ? f.rotateEverySec : undefined,
    micRequestQueueEnabled: f.micRequestQueueEnabled,
    maxTurnSec: Number.isFinite(maxTurn) && maxTurn > 0 ? maxTurn : undefined,
  };
}

/** Same rules the server enforces on create (shared validator), phrased for the form. */
export function validateRoundTableForm(f: RoundTableForm): string[] {
  const errors: string[] = [];
  if (!f.topic.trim()) errors.push('give the discussion a topic');
  const result = validateRoundTableSetup({
    config: roundTableConfigFromForm({ ...f, topic: f.topic.trim() || 'topic' }),
    memberStationIds: f.memberStationIds,
    chairmanStationId: f.chairmanStationId || undefined,
  });
  if (!result.ok) errors.push(...result.errors);
  return errors;
}

const input = 'rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs';

/**
 * Authoring for Annexure-I Ser 3 (spec 7.1): topic, how participants are
 * grouped (manual seats, or a pool split automatically at arm time), how the
 * chairman is chosen (manual pick, or random / rotating), the mic-request
 * queue and an optional turn limit. The builder's shared seat picker is
 * passed as `children` and shown between the two halves: for automatic
 * grouping it is the POOL.
 */
export function RoundTableAuthoring({
  form,
  onChange,
  seatName,
  otherGroupCount,
  children,
}: {
  form: RoundTableForm;
  onChange: (patch: Partial<RoundTableForm>) => void;
  seatName: (stationId: string) => string;
  /** Other groups already in this session — they take group slots the split cannot use. */
  otherGroupCount: number;
  children: ReactNode;
}) {
  const uid = useId();
  const automaticGroups = form.participantAssignment === 'automatic';
  const freeSlots = Math.max(0, MAX_SESSION_GROUPS - 1 - otherGroupCount);
  const sizes = previewGroupSizes(form.memberStationIds.length, form.targetGroupSize, 1 + freeSlots);
  const errors = validateRoundTableForm(form);
  const touched = form.memberStationIds.length > 0 || form.topic.trim().length > 0;

  return (
    <div data-testid="rt-authoring" className="mb-2 space-y-3">
      <input
        value={form.topic}
        onChange={(e) => onChange({ topic: e.target.value })}
        placeholder="Discussion topic (required)"
        className={`w-full ${input}`}
      />

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold text-slate-400">Participants</legend>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="radio" name={`${uid}-participants`} checked={!automaticGroups} onChange={() => onChange({ participantAssignment: 'manual' })} />
          Manual — pick the seats for this group below
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="radio"
            name={`${uid}-participants`}
            checked={automaticGroups}
            onChange={() => onChange({ participantAssignment: 'automatic', chairmanAssignment: 'automatic' })}
          />
          Automatic — pick a pool of seats; students are grouped when you arm the session
        </label>
        {automaticGroups && (
          <div data-testid="rt-auto-preview" className="ml-5 space-y-1 rounded-md bg-slate-900 p-2 text-xs text-slate-300">
            <label className="flex items-center gap-2">
              Target group size
              <input
                type="range"
                min={2}
                max={10}
                value={form.targetGroupSize}
                onChange={(e) => onChange({ targetGroupSize: Number(e.target.value) })}
                aria-label="Target group size"
              />
              <span className="w-4 font-semibold">{form.targetGroupSize}</span>
            </label>
            <p>
              {sizes.length > 0
                ? `Pool of ${form.memberStationIds.length} seats → ${sizes.length} group${sizes.length === 1 ? '' : 's'} (${sizes.join(', ')})`
                : 'Pick at least 2 seats for the pool.'}
            </p>
            <p className="text-slate-500">Only students who are online and signed in when you arm are used; the rest are left out.</p>
          </div>
        )}
      </fieldset>

      {children}

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold text-slate-400">Chairman</legend>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="radio"
            name={`${uid}-chair`}
            checked={form.chairmanAssignment === 'manual'}
            disabled={automaticGroups}
            onChange={() => onChange({ chairmanAssignment: 'manual' })}
          />
          Manual — pick the chairman
          {form.chairmanAssignment === 'manual' && (
            <select value={form.chairmanStationId} onChange={(e) => onChange({ chairmanStationId: e.target.value })} className={input} aria-label="Chairman">
              <option value="">Choose from the group…</option>
              {form.memberStationIds.map((id) => (
                <option key={id} value={id}>
                  {seatName(id)}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="radio"
            name={`${uid}-chair`}
            checked={form.chairmanAssignment === 'automatic'}
            onChange={() => onChange({ chairmanAssignment: 'automatic' })}
          />
          Automatic{automaticGroups ? ' (required with automatic grouping — you can change one before starting)' : ''}
        </label>
        {form.chairmanAssignment === 'automatic' && (
          <div className="ml-5 flex flex-wrap items-center gap-3 text-xs text-slate-300">
            <label className="flex items-center gap-1">
              <input type="radio" name={`${uid}-strategy`} checked={form.chairmanStrategy === 'random'} onChange={() => onChange({ chairmanStrategy: 'random' })} />
              Random
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name={`${uid}-strategy`} checked={form.chairmanStrategy === 'rotate'} onChange={() => onChange({ chairmanStrategy: 'rotate' })} />
              Rotate every
              <input
                type="number"
                min={60}
                step={30}
                value={form.rotateEverySec}
                disabled={form.chairmanStrategy !== 'rotate'}
                onChange={(e) => onChange({ rotateEverySec: Number(e.target.value) })}
                className={`w-16 ${input}`}
                aria-label="Rotate the chair every N seconds"
              />
              s
            </label>
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.micRequestQueueEnabled} onChange={(e) => onChange({ micRequestQueueEnabled: e.target.checked })} />
          Students can request the mic (queue)
        </label>
        <label className="flex items-center gap-2">
          Max turn
          <input
            type="number"
            min={10}
            placeholder="none"
            value={form.maxTurnSec}
            onChange={(e) => onChange({ maxTurnSec: e.target.value })}
            className={`w-16 ${input}`}
            aria-label="Maximum speaking turn in seconds"
          />
          s
        </label>
      </div>

      {touched && errors.length > 0 && (
        <ul data-testid="rt-authoring-errors" className="list-disc space-y-0.5 pl-5 text-xs text-amber-400">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
