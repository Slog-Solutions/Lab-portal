import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileBarChart, Plus, Send } from 'lucide-react';
import { CEFR_LEVELS, MediaAssetScope, UserRole } from '@lab/shared';
import { contentExercisesApi, type ContentExerciseRow } from '../../lib/content-exercises-api';
import { contentPackagesApi } from '../../lib/content-packages-api';
import { batchesApi } from '../../lib/batches-api';
import { usersApi } from '../../lib/users-api';
import { getRuntimeConfig } from '../../lib/runtime-config';
import { StudentPicker } from '../exercises/StudentPicker';
import { PageTitle } from '@/components/layout/PageTitle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

const GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12', 'Adult'];
const QUERY_KEY = ['content-exercises'];

export function previewUrl(pkg: { id: string; entryPoint: string }): string {
  return `${getRuntimeConfig().serverUrl}/api/content-packages/${pkg.id}/files/${pkg.entryPoint}`;
}

function gradeOrder(g: string): number {
  const n = Number(/\d+/.exec(g)?.[0]);
  return Number.isFinite(n) ? n : 99;
}

/**
 * Annexure-I Ser 4 "Content Exercise": ready-made and publisher content
 * (HTML / SCORM / xAPI), browsed grade-wise and level-wise, sent to a class
 * or to students — optionally opening straight onto their screens — with a
 * detailed score report per exercise.
 */
export function ContentExercisesPage() {
  const [grade, setGrade] = useState('all');
  const [level, setLevel] = useState('all');
  const [source, setSource] = useState<'all' | 'builtin' | 'mine'>('all');
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState<ContentExerciseRow | null>(null);
  const list = useQuery({ queryKey: QUERY_KEY, queryFn: contentExercisesApi.list });

  const rows = useMemo(
    () =>
      (list.data ?? [])
        .filter((r) => grade === 'all' || r.gradeLevel === grade)
        .filter((r) => level === 'all' || r.cefrLevel === level)
        .filter((r) => source === 'all' || (source === 'builtin') === r.builtin)
        .sort((a, b) => gradeOrder(a.gradeLevel) - gradeOrder(b.gradeLevel) || a.title.localeCompare(b.title)),
    [list.data, grade, level, source],
  );
  const grades = [...new Set((list.data ?? []).map((r) => r.gradeLevel))].sort((a, b) => gradeOrder(a) - gradeOrder(b));

  return (
    <div>
      <PageTitle
        title="Content Exercises"
        subtitle="Ready-made and publisher content (HTML, SCORM, xAPI) — grade-wise and level-wise. Send it to students and review every score."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add publisher content
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          Grade
          <NativeSelect compact value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="Grade">
            <option value="all">All grades</option>
            {grades.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Level
          <NativeSelect compact value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
            <option value="all">All levels</option>
            {CEFR_LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Source
          <NativeSelect compact value={source} onChange={(e) => setSource(e.target.value as typeof source)} aria-label="Source">
            <option value="all">All content</option>
            <option value="builtin">Ready-made</option>
            <option value="mine">Imported</option>
          </NativeSelect>
        </label>
      </div>

      {list.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {list.error && <p className="text-sm text-destructive">{list.error.message}</p>}
      {list.data && rows.length === 0 && <p className="text-sm text-muted-foreground">No content matches these filters.</p>}

      <div className="overflow-x-auto rounded-card border border-hairline bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-hairline">
              <th className="px-4 py-2 font-normal">Exercise</th>
              <th className="px-4 py-2 font-normal">Grade</th>
              <th className="px-4 py-2 font-normal">Level</th>
              <th className="px-4 py-2 font-normal">Publisher</th>
              <th className="px-4 py-2 text-right font-normal">Students</th>
              <th className="px-4 py-2 text-right font-normal">Average</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.package?.format ?? '—'}
                    {r.builtin ? ' · ready-made' : r.teacherName ? ` · added by ${r.teacherName}` : ''}
                  </p>
                </td>
                <td className="px-4 py-3">{r.gradeLevel}</td>
                <td className="px-4 py-3">{r.cefrLevel ? <Badge variant="outline">{r.cefrLevel}</Badge> : '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.package?.publisher ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  {r.completedBy}/{r.assigned}
                </td>
                <td className="px-4 py-3 text-right">{r.average !== null ? `${Math.round(r.average)}%` : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    {r.package && (
                      <Button asChild size="sm" variant="ghost" title="Preview">
                        <a href={previewUrl(r.package)} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setSending(r)}>
                      <Send className="mr-1.5 h-3.5 w-3.5" /> Send
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/content-exercises/${r.id}`}>
                        <FileBarChart className="mr-1.5 h-3.5 w-3.5" /> Report
                      </Link>
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddContentDialog open={adding} onOpenChange={setAdding} />
      {sending && <SendDialog exercise={sending} onClose={() => setSending(null)} />}
    </div>
  );
}

/** Import a publisher's package (e.g. licensed Encyclopaedia Britannica
 * content, or any HTML / SCORM / xAPI export) and create its exercise. */
function AddContentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState('HTML');
  const [publisher, setPublisher] = useState('');
  const [gradeLevel, setGradeLevel] = useState('Grade 8');
  const [cefrLevel, setCefrLevel] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const pkg = await contentPackagesApi.import(file!, {
        title,
        format,
        scope: MediaAssetScope.INSTITUTION,
        publisher,
        gradeLevel,
        cefrLevel,
      });
      return contentExercisesApi.create({
        contentPackageId: pkg.id,
        title,
        gradeLevel,
        ...(cefrLevel ? { cefrLevel: cefrLevel as (typeof CEFR_LEVELS)[number] } : {}),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
      onOpenChange(false);
      setFile(null);
      setTitle('');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add publisher content</DialogTitle>
          <DialogDescription>
            Upload a single .html page, or a .zip of an HTML site, SCORM 1.2 / 2004 or xAPI package. It opens for students in an exercise window
            with all its text, images and audio.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ce-file">File</Label>
            <Input id="ce-file" type="file" accept=".zip,.html,.htm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ce-title">Title</Label>
            <Input id="ce-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rainforests of the World" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ce-format">Format</Label>
              <NativeSelect id="ce-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="HTML">HTML</option>
                <option value="SCORM12">SCORM 1.2</option>
                <option value="SCORM2004">SCORM 2004</option>
                <option value="XAPI">xAPI</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ce-publisher">Publisher</Label>
              <Input id="ce-publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="e.g. Encyclopaedia Britannica" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ce-grade">Grade</Label>
              <NativeSelect id="ce-grade" value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}>
                {GRADES.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ce-level">Level (CEFR)</Label>
              <NativeSelect id="ce-level" value={cefrLevel} onChange={(e) => setCefrLevel(e.target.value)}>
                <option value="">Not set</option>
                {CEFR_LEVELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!file || !title.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Uploading…' : 'Add content'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Send to a whole class or to picked students; optionally open it on
 * their screens right now (Ser 4 "launch content files directly to
 * students into an exercise window"). */
function SendDialog({ exercise, onClose }: { exercise: ContentExerciseRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'class' | 'students'>('class');
  const [batchId, setBatchId] = useState('');
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState('');
  const [openNow, setOpenNow] = useState(true);
  const classes = useQuery({ queryKey: ['batches', 'mine'], queryFn: batchesApi.mine });
  const students = useQuery({ queryKey: ['users', 'STUDENT'], queryFn: () => usersApi.list(UserRole.STUDENT), enabled: mode === 'students' });
  const send = useMutation({
    mutationFn: () =>
      contentExercisesApi.launch(exercise.id, {
        ...(mode === 'class' ? { batchId } : { studentIds }),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        openNow,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send “{exercise.title}”</DialogTitle>
          <DialogDescription>
            {exercise.gradeLevel}
            {exercise.cefrLevel ? ` · ${exercise.cefrLevel}` : ''} — students find it in their Assignments.
          </DialogDescription>
        </DialogHeader>
        {send.data ? (
          <div className="space-y-2 text-sm">
            <p>
              Sent to {send.data.students} student{send.data.students === 1 ? '' : 's'}
              {send.data.skipped ? ` (${send.data.skipped} already had it open)` : ''}.
            </p>
            {openNow && <p>Opened on {send.data.openedOnSeats} signed-in seat{send.data.openedOnSeats === 1 ? '' : 's'} right now.</p>}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button size="sm" variant={mode === 'class' ? 'default' : 'outline'} onClick={() => setMode('class')}>
                  A class
                </Button>
                <Button size="sm" variant={mode === 'students' ? 'default' : 'outline'} onClick={() => setMode('students')}>
                  Chosen students
                </Button>
              </div>
              {mode === 'class' ? (
                <NativeSelect value={batchId} onChange={(e) => setBatchId(e.target.value)} aria-label="Class">
                  <option value="">Choose a class…</option>
                  {(classes.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.studentCount} students)
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  <StudentPicker students={students.data ?? []} selected={studentIds} onChange={setStudentIds} />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="ce-due">Due (optional)</Label>
                <Input id="ce-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={openNow} onCheckedChange={(v) => setOpenNow(v === true)} />
                Open it on their screens now (students who are signed in at a seat)
              </label>
              {send.error && <p className="text-sm text-destructive">{send.error.message}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={send.isPending || (mode === 'class' ? !batchId : studentIds.length === 0)}
                onClick={() => send.mutate()}
              >
                {send.isPending ? 'Sending…' : 'Send'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
