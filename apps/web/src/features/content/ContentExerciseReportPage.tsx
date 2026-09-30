import { Fragment, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, Pencil } from 'lucide-react';
import { contentExercisesApi, type ContentReport, type ContentReportRow } from '../../lib/content-exercises-api';
import { gradebookApi } from '../../lib/gradebook-api';
import { PageTitle } from '@/components/layout/PageTitle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}

function duration(sec: number | null): string {
  if (sec === null) return '—';
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The report as a spreadsheet: one line per student, then one per answer. */
function downloadCsv(report: ContentReport): void {
  const lines = [['Student', 'Service number', 'Status', 'Score %', 'Score before edit %', 'Edited reason', 'Submitted', 'Time taken', 'Question', 'Answer given', 'Correct answer', 'Correct?']];
  for (const r of report.rows) {
    const a = r.attempt;
    const base = [r.fullName, r.serviceNumber, a?.status ?? 'NOT STARTED', a?.score ?? '', a?.packageScore ?? '', a?.edited?.reason ?? '', a?.submittedAt ?? '', duration(a?.durationSec ?? null)];
    if (!a || a.items.length === 0) lines.push([...base, '', '', '', ''].map(String));
    for (const item of a?.items ?? []) lines.push([...base, item.prompt ?? item.itemId, item.given ?? '', item.expected ?? '', item.correct ? 'yes' : 'no'].map(String));
  }
  const blob = new Blob([lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${report.exercise.title.replace(/[^\w-]+/g, '_')}_scores.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Ser 4 "Report tool for the content exercise activity should allow
 * teachers to view, edit and save a detailed listing of student scores".
 * Editing saves through the gradebook override (audited, reason required),
 * so the content's own score is never silently overwritten.
 */
export function ContentExerciseReportPage() {
  const { id = '' } = useParams();
  const report = useQuery({ queryKey: ['content-exercises', id, 'report'], queryFn: () => contentExercisesApi.report(id) });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const data = report.data;

  return (
    <div>
      <PageTitle
        title={data?.exercise.title ?? 'Content exercise report'}
        subtitle={
          data
            ? `${data.exercise.gradeLevel}${data.exercise.cefrLevel ? ` · ${data.exercise.cefrLevel}` : ''}${data.exercise.package?.publisher ? ` · ${data.exercise.package.publisher}` : ''}`
            : undefined
        }
        breadcrumbs={[{ label: 'Content Exercises', to: '/content-exercises' }, { label: 'Report' }]}
        actions={
          data && (
            <Button variant="outline" onClick={() => downloadCsv(data)}>
              <Download className="mr-1.5 h-4 w-4" /> Export (CSV)
            </Button>
          )
        }
      />
      {report.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {report.error && <p className="text-sm text-destructive">{report.error.message}</p>}
      {data && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3 sm:max-w-xl">
            {[
              ['Students', String(data.summary.students)],
              ['Completed', String(data.summary.completed)],
              ['Average', data.summary.average !== null ? `${Math.round(data.summary.average)}%` : '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-card border border-hairline bg-card p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          {data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody has been sent this exercise yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-card border border-hairline bg-card">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b border-hairline">
                    <th className="w-8 px-2 py-2" />
                    <th className="px-3 py-2 font-normal">Student</th>
                    <th className="px-3 py-2 font-normal">Status</th>
                    <th className="px-3 py-2 font-normal">Submitted</th>
                    <th className="px-3 py-2 font-normal">Time</th>
                    <th className="px-3 py-2 text-right font-normal">Score</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <Fragment key={r.studentId}>
                      <ReportRow
                        row={r}
                        expanded={open.has(r.studentId)}
                        onToggle={() =>
                          setOpen((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.studentId)) next.delete(r.studentId);
                            else next.add(r.studentId);
                            return next;
                          })
                        }
                        editing={editing === r.studentId}
                        onEdit={(on) => setEditing(on ? r.studentId : null)}
                        exerciseId={id}
                      />
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReportRow({
  row,
  expanded,
  onToggle,
  editing,
  onEdit,
  exerciseId,
}: {
  row: ContentReportRow;
  expanded: boolean;
  onToggle: () => void;
  editing: boolean;
  onEdit: (on: boolean) => void;
  exerciseId: string;
}) {
  const qc = useQueryClient();
  const a = row.attempt;
  const [score, setScore] = useState(a?.score !== null && a?.score !== undefined ? String(a.score) : '');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => gradebookApi.override(a!.id, Number(score), reason.trim()),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['content-exercises', exerciseId, 'report'] });
      await qc.invalidateQueries({ queryKey: ['content-exercises'] });
      onEdit(false);
      setReason('');
    },
  });
  const scored = a?.status === 'SCORED';
  const valid = score !== '' && Number(score) >= 0 && Number(score) <= 100 && reason.trim().length > 0;

  return (
    <>
      <tr className="border-b border-hairline">
        <td className="px-2 py-2">
          {a && a.items.length > 0 && (
            <button type="button" onClick={onToggle} aria-label={expanded ? 'Hide answers' : 'Show answers'} className="rounded p-1 hover:bg-accent">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </td>
        <td className="px-3 py-2">
          <p className="font-medium">{row.fullName}</p>
          <p className="text-xs text-muted-foreground">{row.serviceNumber}</p>
        </td>
        <td className="px-3 py-2">
          {!a ? <Badge variant="outline">Not started</Badge> : scored ? <Badge variant="success">Completed</Badge> : <Badge variant="warning">In progress</Badge>}
          {row.attempts > 1 && <span className="ml-1 text-xs text-muted-foreground">{row.attempts} tries</span>}
        </td>
        <td className="px-3 py-2 text-muted-foreground">{fmt(a?.submittedAt ?? null)}</td>
        <td className="px-3 py-2 text-muted-foreground">{duration(a?.durationSec ?? null)}</td>
        <td className="px-3 py-2 text-right">
          {scored && a!.score !== null ? (
            <span className="font-semibold">{Math.round(a!.score)}%</span>
          ) : (
            '—'
          )}
          {a?.edited && (
            <p className="text-xs text-muted-foreground" title={a.edited.reason}>
              edited (was {a.packageScore !== null ? `${Math.round(a.packageScore)}%` : '—'})
            </p>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {scored && !editing && (
            <Button size="sm" variant="ghost" onClick={() => onEdit(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-hairline bg-cream/40">
          <td />
          <td colSpan={6} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                New score (%)
                <Input type="number" min={0} max={100} className="w-24" value={score} onChange={(e) => setScore(e.target.value)} />
              </label>
              <label className="min-w-[16rem] flex-1 space-y-1 text-xs text-muted-foreground">
                Reason (kept in the audit log)
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. marked the essay answer by hand" />
              </label>
              <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onEdit(false)}>
                Cancel
              </Button>
            </div>
            {save.error && <p className="mt-1 text-sm text-destructive">{save.error.message}</p>}
          </td>
        </tr>
      )}
      {expanded && a && (
        <tr className="border-b border-hairline">
          <td />
          <td colSpan={6} className="px-3 pb-3">
            <ol className="space-y-1 rounded-control border border-hairline p-3">
              {a.items.map((item, i) => (
                <li key={`${item.itemId}-${i}`} className="flex gap-2">
                  <span className={item.correct ? 'text-status-online' : 'text-destructive'}>{item.correct ? '✓' : '✗'}</span>
                  <span>
                    {item.prompt ?? item.itemId}
                    <span className="block text-xs text-muted-foreground">
                      Answer: {item.given || '(blank)'}
                      {!item.correct && item.expected ? ` · correct: ${item.expected}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </td>
        </tr>
      )}
    </>
  );
}
