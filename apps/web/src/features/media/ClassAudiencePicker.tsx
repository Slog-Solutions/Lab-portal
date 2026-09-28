import { useQuery } from '@tanstack/react-query';
import { batchesApi } from '../../lib/batches-api';
import { queryKeys } from '../../lib/query-keys';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Who a study file is shown to, once it is switched on for students: every
 * student, or only the students of the classes ticked here. Held as a mode plus
 * a list so "Selected classes" with nothing ticked is a state the form can
 * see and refuse, instead of quietly meaning everyone (which is what an empty
 * `sharedBatchIds` means on the server).
 */
export interface Audience {
  mode: 'all' | 'classes';
  batchIds: string[];
}

export const ALL_STUDENTS: Audience = { mode: 'all', batchIds: [] };

export function audienceOf(sharedBatchIds: string[]): Audience {
  return sharedBatchIds.length === 0 ? ALL_STUDENTS : { mode: 'classes', batchIds: sharedBatchIds };
}

/** The list sent to the server: empty means all students. */
export function toSharedBatchIds(audience: Audience): string[] {
  return audience.mode === 'all' ? [] : audience.batchIds;
}

/** "Selected classes" needs at least one class. */
export function isAudienceComplete(audience: Audience): boolean {
  return audience.mode === 'all' || audience.batchIds.length > 0;
}

/** The teacher's own classes (an admin sees every class) — the only ones a file can be aimed at. */
export function useSharableClasses() {
  return useQuery({ queryKey: queryKeys.myClasses, queryFn: batchesApi.mine });
}

export function ClassAudiencePicker({ value, onChange }: { value: Audience; onChange: (next: Audience) => void }) {
  const { data: classes, isLoading } = useSharableClasses();
  const noClasses = !isLoading && (classes?.length ?? 0) === 0;
  // Ids already on the file that aren't one of this teacher's classes (an admin
  // aimed it there) stay in the list untouched — only the ticks below change it.
  const hidden = value.batchIds.filter((id) => !classes?.some((c) => c.id === id));

  function toggle(id: string, on: boolean): void {
    const next = on ? [...value.batchIds, id] : value.batchIds.filter((x) => x !== id);
    onChange({ mode: 'classes', batchIds: next });
  }

  return (
    <div className="space-y-2">
      <Select value={value.mode} onValueChange={(mode) => onChange({ ...value, mode: mode as Audience['mode'] })}>
        <SelectTrigger className="w-48" aria-label="Who can see this file">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All students</SelectItem>
          <SelectItem value="classes" disabled={noClasses}>
            Selected classes
          </SelectItem>
        </SelectContent>
      </Select>

      {noClasses && <p className="text-xs text-muted-foreground">You aren’t assigned to a class yet, so this can only go to all students.</p>}

      {value.mode === 'classes' && (
        <div className="max-h-44 w-72 space-y-1.5 overflow-y-auto rounded-md border p-2">
          {isLoading && <p className="text-xs text-muted-foreground">Loading classes…</p>}
          {classes?.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={value.batchIds.includes(c.id)} onCheckedChange={(on) => toggle(c.id, on === true)} />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {c.code} · {c.studentCount}
              </span>
            </label>
          ))}
          {hidden.length > 0 && <p className="text-xs text-muted-foreground">+ {hidden.length} other class{hidden.length === 1 ? '' : 'es'} set by an admin</p>}
        </div>
      )}
      {value.mode === 'classes' && value.batchIds.length === 0 && !isLoading && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Tick at least one class.</p>
      )}
    </div>
  );
}
