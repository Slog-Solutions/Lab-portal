import { useId, type ReactNode } from 'react';
import { MAX_SESSION_GROUPS, previewGroupSizes, validateRoundTableSetup } from '@lab/shared/activities';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';

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


/** A radio rendered as a selectable card: title + one-line description. */
function ChoiceCard({
  name,
  checked,
  disabled,
  onSelect,
  title,
  description,
  children,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer gap-3 rounded-control border p-3 transition-colors',
        checked ? 'border-brand bg-brand-soft' : 'border-input bg-card hover:bg-accent',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-card',
      )}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} className="mt-0.5 h-4 w-4 shrink-0 accent-brand" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
        {children}
      </span>
    </label>
  );
}

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-foreground">
      {children}
    </label>
  );
}

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
    <div data-testid="rt-authoring" className="space-y-5">
      <div>
        <FieldLabel htmlFor={`${uid}-topic`}>Discussion topic</FieldLabel>
        <Input
          id={`${uid}-topic`}
          value={form.topic}
          onChange={(e) => onChange({ topic: e.target.value })}
          placeholder="Discussion topic (required)"
        />
      </div>

      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-foreground">Participants</legend>
        <div className="grid gap-2 @lg:grid-cols-2">
          <ChoiceCard
            name={`${uid}-participants`}
            checked={!automaticGroups}
            onSelect={() => onChange({ participantAssignment: 'manual' })}
            title="Manual"
            description="Pick the seats for this group below"
          />
          <ChoiceCard
            name={`${uid}-participants`}
            checked={automaticGroups}
            onSelect={() => onChange({ participantAssignment: 'automatic', chairmanAssignment: 'automatic' })}
            title="Automatic"
            description="Pick a pool of seats; students are grouped when you arm the session"
          />
        </div>
        {automaticGroups && (
          <div data-testid="rt-auto-preview" className="mt-2 space-y-2 rounded-control bg-muted/60 p-3 text-xs text-foreground">
            <label className="flex items-center gap-3">
              <span className="font-medium">Target group size</span>
              <input
                type="range"
                min={2}
                max={10}
                value={form.targetGroupSize}
                onChange={(e) => onChange({ targetGroupSize: Number(e.target.value) })}
                aria-label="Target group size"
                className="w-40 accent-brand"
              />
              <span className="w-5 text-sm font-semibold tabular-nums">{form.targetGroupSize}</span>
            </label>
            <p className="font-medium">
              {sizes.length > 0
                ? `Pool of ${form.memberStationIds.length} seats → ${sizes.length} group${sizes.length === 1 ? '' : 's'} (${sizes.join(', ')})`
                : 'Pick at least 2 seats for the pool.'}
            </p>
            <p className="text-muted-foreground">Only students who are online and signed in when you arm are used; the rest are left out.</p>
          </div>
        )}
      </fieldset>

      {children}

      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-foreground">Chairman</legend>
        <div className="grid gap-2 @lg:grid-cols-2">
          <ChoiceCard
            name={`${uid}-chair`}
            checked={form.chairmanAssignment === 'manual'}
            disabled={automaticGroups}
            onSelect={() => onChange({ chairmanAssignment: 'manual' })}
            title="Manual"
            description={automaticGroups ? 'Not available with automatic grouping' : 'Pick the chairman from this group'}
          />
          <ChoiceCard
            name={`${uid}-chair`}
            checked={form.chairmanAssignment === 'automatic'}
            onSelect={() => onChange({ chairmanAssignment: 'automatic' })}
            title="Automatic"
            description={
              automaticGroups ? 'Required with automatic grouping — you can change one before starting' : 'Chosen at random or rotated on a timer'
            }
          />
        </div>

        {form.chairmanAssignment === 'manual' && (
          <NativeSelect
            className="mt-2 w-full @lg:w-72"
            value={form.chairmanStationId}
            onChange={(e) => onChange({ chairmanStationId: e.target.value })}
            aria-label="Chairman"
            disabled={form.memberStationIds.length === 0}
          >
            <option value="">{form.memberStationIds.length === 0 ? 'Pick seats first…' : 'Choose from the group…'}</option>
            {form.memberStationIds.map((id) => (
              <option key={id} value={id}>
                {seatName(id)}
              </option>
            ))}
          </NativeSelect>
        )}

        {form.chairmanAssignment === 'automatic' && (
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-control bg-muted/60 px-3 py-2.5 text-sm text-foreground">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={`${uid}-strategy`}
                checked={form.chairmanStrategy === 'random'}
                onChange={() => onChange({ chairmanStrategy: 'random' })}
                className="h-4 w-4 accent-brand"
              />
              Random
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={`${uid}-strategy`}
                checked={form.chairmanStrategy === 'rotate'}
                onChange={() => onChange({ chairmanStrategy: 'rotate' })}
                className="h-4 w-4 accent-brand"
              />
              Rotate every
              <Input
                type="number"
                min={60}
                step={30}
                value={form.rotateEverySec}
                disabled={form.chairmanStrategy !== 'rotate'}
                onChange={(e) => onChange({ rotateEverySec: Number(e.target.value) })}
                className="h-8 w-20"
                aria-label="Rotate the chair every N seconds"
              />
              <span className="text-muted-foreground">seconds</span>
            </label>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-foreground">Floor rules</legend>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-foreground">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={form.micRequestQueueEnabled}
              onChange={(e) => onChange({ micRequestQueueEnabled: e.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            Students can request the mic (queue)
          </label>
          <label className="flex items-center gap-2">
            Max turn
            <Input
              type="number"
              min={10}
              placeholder="No limit"
              value={form.maxTurnSec}
              onChange={(e) => onChange({ maxTurnSec: e.target.value })}
              className="h-8 w-24"
              aria-label="Maximum speaking turn in seconds"
            />
            <span className="text-muted-foreground">seconds</span>
          </label>
        </div>
      </fieldset>

      {touched && errors.length > 0 && (
        <div className="rounded-control border border-status-pending/40 bg-status-pending/10 px-3 py-2.5">
          <p className="text-xs font-semibold text-foreground">Before this group can be created:</p>
          <ul data-testid="rt-authoring-errors" className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-foreground">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
