import { useState } from 'react';
import type { UserRow } from '../../lib/users-api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

/** Searchable multi-select of students, with select-all-shown. Used by the
 * pronunciation test builder and by "send to more students" on a test's
 * results page. `tag` lets a caller flag a student inline (e.g. "already
 * assigned") without this component knowing why. */
export function StudentPicker({
  students,
  selected,
  onChange,
  tag,
}: {
  students: UserRow[];
  selected: string[];
  onChange: (next: string[]) => void;
  tag?: (student: UserRow) => string | null;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? students.filter((s) => s.fullName.toLowerCase().includes(needle) || s.serviceNumber.toLowerCase().includes(needle))
    : students;
  const selectedSet = new Set(selected);
  const allShownSelected = shown.length > 0 && shown.every((s) => selectedSet.has(s.id));

  function toggle(id: string, checked: boolean): void {
    onChange(checked ? [...selected, id] : selected.filter((x) => x !== id));
  }

  function toggleAllShown(): void {
    if (allShownSelected) {
      const shownIds = new Set(shown.map((s) => s.id));
      onChange(selected.filter((id) => !shownIds.has(id)));
    } else {
      onChange([...new Set([...selected, ...shown.map((s) => s.id)])]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or service number" className="h-8" />
        <Button type="button" variant="outline" size="sm" onClick={toggleAllShown} disabled={shown.length === 0}>
          {allShownSelected ? 'Clear shown' : 'Select shown'}
        </Button>
      </div>
      <div className="max-h-56 space-y-0.5 overflow-auto rounded-md border border-border p-1">
        {shown.length === 0 && <p className="p-2 text-xs text-muted-foreground">{students.length === 0 ? 'No students yet.' : 'No students match.'}</p>}
        {shown.map((s) => {
          const note = tag?.(s);
          return (
            <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent/50">
              <Checkbox checked={selectedSet.has(s.id)} onCheckedChange={(checked) => toggle(s.id, checked === true)} />
              <span className="flex-1 truncate">
                {s.serviceNumber} — {s.fullName}
              </span>
              {note && <span className="shrink-0 text-xs text-muted-foreground">{note}</span>}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{selected.length} selected</p>
    </div>
  );
}
