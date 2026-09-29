import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRole } from '@lab/shared';
import { CheckCircle2, ChevronRight, Loader2, School, Upload, X } from 'lucide-react';
import { assessmentsApi, type AssessmentSummary, type CreateAssessmentInput, type VocabQuestionInput } from '../../lib/assessments-api';
import { batchesApi } from '../../lib/batches-api';
import type { MediaAsset } from '../../lib/media-assets-api';
import { usersApi, type UserRow } from '../../lib/users-api';
import { queryKeys } from '../../lib/query-keys';
import { StudentPicker } from '../exercises/StudentPicker';
import { AudioPicker } from './AudioPicker';
import { DocumentPicker } from './DocumentPicker';
import { ImportQuestionsDialog } from './ImportQuestionsDialog';
import { VocabularyTestBuilder, validateQuestion } from './VocabularyTestBuilder';
import { DEFAULT_SETTINGS_DRAFT, TestSettingsPanel, settingsDraftToApi, settingsDraftValid, type TestSettingsDraft } from './TestSettingsPanel';
import { kindBySlug, type AssignmentKind } from './assignment-kinds';
import { analyseQuestionList, MAX_QUESTIONS } from './question-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const TITLE_PLACEHOLDER: Record<AssignmentKind['type'], string> = {
  VOCABULARY_TEST: 'e.g. "Unit 3 — travel words"',
  WRITING_TEST: 'e.g. "Describe your hometown"',
  LISTENING_TEST: 'e.g. "Airport announcement"',
  READING_TEST: 'e.g. "Read aloud — paragraph 4"',
};

// A listening test's question list still uses the same word-list syntax
// directly (it has no form builder of its own — SPEC-mcq-test-timed-reveal.md
// only extends the vocabulary test's authoring); vocabulary's own hint now
// lives in ImportQuestionsDialog.
const QUESTION_HINT: Record<'LISTENING_TEST', string> = {
  LISTENING_TEST: `What time does it depart? = 9:30      → the student types the answer
Which gate? = B12 | A4 | C9            → multiple choice (the first one is correct)`,
};

/** A positive whole number from a number input, or undefined when it is blank/invalid. */
function positiveInt(text: string): number | undefined {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

interface Draft {
  title: string;
  instructions: string;
  // writing
  prompt: string;
  minWords: string;
  maxWords: string;
  // listening
  questions: string;
  // reading
  passage: string;
}
const EMPTY_DRAFT: Draft = {
  title: '',
  instructions: '',
  prompt: '',
  minWords: '',
  maxWords: '',
  questions: '',
  passage: '',
};

/** Builds the request for this kind, or null while the form isn't complete. */
function buildInput(
  kind: AssignmentKind,
  d: Draft,
  ctx: {
    studentIds: string[];
    dueDate: string;
    audio: MediaAsset | null;
    document: MediaAsset | null;
    batchId?: string;
    dictionaryEnabled: boolean | null;
    questions: VocabQuestionInput[];
    settings: TestSettingsDraft;
  },
): CreateAssessmentInput | null {
  const title = d.title.trim();
  if (!title) return null;
  // SPEC-mcq-test-timed-reveal.md §6.1 "save without assigning" — a
  // vocabulary test alone may have zero students (it can be launched in
  // the lab later instead); every other kind still needs at least one.
  if (kind.type !== 'VOCABULARY_TEST' && ctx.studentIds.length === 0) return null;
  const common = {
    title,
    studentIds: ctx.studentIds,
    dueAt: ctx.dueDate ? new Date(`${ctx.dueDate}T23:59:59`).toISOString() : undefined,
    batchId: ctx.batchId,
    dictionaryEnabled: ctx.dictionaryEnabled ?? undefined,
  };
  const instructions = d.instructions.trim() || undefined;

  switch (kind.type) {
    case 'VOCABULARY_TEST': {
      if (ctx.questions.length === 0 || ctx.questions.length > MAX_QUESTIONS) return null;
      if (ctx.questions.some((q) => validateQuestion(q).length > 0)) return null;
      if (!settingsDraftValid(ctx.settings)) return null;
      return { ...common, type: kind.type, questions: ctx.questions, ...settingsDraftToApi(ctx.settings) };
    }
    case 'WRITING_TEST': {
      const prompt = d.prompt.trim();
      const minWords = positiveInt(d.minWords);
      const maxWords = positiveInt(d.maxWords);
      if (!prompt || (minWords && maxWords && minWords > maxWords)) return null;
      return { ...common, type: kind.type, prompt, instructions, minWords, maxWords };
    }
    case 'LISTENING_TEST': {
      const list = analyseQuestionList(d.questions);
      if (!ctx.audio || list.count === 0 || list.badLine || list.count > MAX_QUESTIONS) return null;
      return { ...common, type: kind.type, audioAssetId: ctx.audio.id, instructions, questionsText: d.questions };
    }
    case 'READING_TEST': {
      const passage = d.passage.trim();
      if (!passage && !ctx.document) return null;
      return { ...common, type: kind.type, passage: passage || undefined, documentAssetId: ctx.document?.id, instructions };
    }
  }
}

/** One question per line, with the running count and the first bad line called out. */
function QuestionListField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  rows = 8,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  hint: string;
  rows?: number;
}) {
  const { count, badLine } = analyseQuestionList(value);
  const tooMany = count > MAX_QUESTIONS;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className={`text-xs ${tooMany ? 'text-destructive' : 'text-muted-foreground'}`}>
          {count}/{MAX_QUESTIONS}
        </span>
      </div>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} className="resize-none font-mono text-sm" />
      {badLine && (
        <p className="text-xs text-destructive">
          Each line needs a question, then &quot;=&quot;, then the answer — check: <span className="font-mono">{badLine}</span>
        </p>
      )}
      <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{hint}</pre>
    </div>
  );
}

/** This kind's assignments, newest first, with progress and a way into the results. */
function AssignmentList({ kind }: { kind: AssignmentKind }) {
  const { data, isLoading } = useQuery({ queryKey: queryKeys.assessments(kind.type), queryFn: () => assessmentsApi.list(kind.type) });
  const isHandMarked = kind.type === 'WRITING_TEST' || kind.type === 'READING_TEST';
  // One prompt/passage, not a question list — the count column would always read "1".
  const hidesQuestionCount = isHandMarked;

  function result(a: AssessmentSummary) {
    if (a.toGrade > 0) return <Badge variant="warning">{a.toGrade} to mark</Badge>;
    if (a.averageScore !== null) return <span className="text-sm">{a.averageScore}% avg</span>;
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your {kind.label.toLowerCase()}s</CardTitle>
        <CardDescription>
          {kind.type === 'WRITING_TEST'
            ? 'Open one to read the essays and mark them.'
            : kind.type === 'READING_TEST'
              ? 'Open one to listen to each student and mark them.'
              : 'Open one to see every student’s answers.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !data || data.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No {kind.label.toLowerCase()}s yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assignment</TableHead>
                {!hidesQuestionCount && <TableHead>Questions</TableHead>}
                <TableHead>Submitted</TableHead>
                <TableHead>Result</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <p className="font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.teacherName} · {new Date(a.createdAt).toLocaleDateString()}
                    </p>
                  </TableCell>
                  {!hidesQuestionCount && <TableCell>{a.questionCount}</TableCell>}
                  <TableCell>
                    {a.submitted}/{a.assigned}
                  </TableCell>
                  <TableCell>{result(a)}</TableCell>
                  <TableCell>
                    <Link to={`/assignments/${kind.slug}/${a.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      Results
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CreateAssignmentForm({ kind }: { kind: AssignmentKind }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const classId = searchParams.get('classId');

  // All students (used when no classId filter is active)
  const { data: allStudents } = useQuery({
    queryKey: queryKeys.users(UserRole.STUDENT),
    queryFn: () => usersApi.list(UserRole.STUDENT),
    enabled: !classId,
  });

  // Class-specific students (used when classId filter IS active)
  const { data: classStudents, isLoading: classStudentsLoading } = useQuery({
    queryKey: queryKeys.classStudents(classId ?? ''),
    queryFn: () => batchesApi.listStudents(classId!),
    enabled: !!classId,
  });

  // The class info, for the banner
  const { data: myClasses } = useQuery({
    queryKey: queryKeys.myClasses,
    queryFn: batchesApi.mine,
    enabled: !!classId,
  });
  const linkedClass = myClasses?.find((c) => c.id === classId);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [questions, setQuestions] = useState<VocabQuestionInput[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<TestSettingsDraft>(DEFAULT_SETTINGS_DRAFT);
  const [showImport, setShowImport] = useState(false);
  const [audio, setAudio] = useState<MediaAsset | null>(null);
  const [documentAsset, setDocumentAsset] = useState<MediaAsset | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [created, setCreated] = useState<{ exerciseId: string; questionCount: number; assigned: number } | null>(null);
  const [autoSelected, setAutoSelected] = useState(false);
  // Offline dictionary (SPEC-offline-dictionary.md §7) — null means "not
  // touched", so the checkbox shows (and create sends) this kind's own
  // default (VOCABULARY_TEST off, everything else on) until the teacher
  // explicitly picks a value. Reset on a kind switch so an explicit choice
  // for one test type doesn't silently carry over to a different one.
  const [dictionaryEnabled, setDictionaryEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    setDictionaryEnabled(null);
    setQuestions([]);
    setSettingsDraft(DEFAULT_SETTINGS_DRAFT);
  }, [kind.type]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  // Convert enrolled students to UserRow-compatible objects for StudentPicker
  const classStudentRows: UserRow[] = (classStudents ?? []).filter((s) => s.user.active).map((s) => ({
    id: s.userId,
    serviceNumber: s.user.serviceNumber,
    fullName: s.user.fullName,
    role: 'STUDENT' as const,
    rank: null,
    active: true,
  }));

  const activeStudents = classId ? classStudentRows : (allStudents ?? []).filter((s) => s.active);

  // Auto-select all class students once when loaded
  useEffect(() => {
    if (classId && classStudentRows.length > 0 && !autoSelected) {
      setSelected(classStudentRows.map((s) => s.id));
      setAutoSelected(true);
    }
  }, [classId, classStudentRows.length, autoSelected]);
  const input = buildInput(kind, draft, {
    studentIds: selected,
    dueDate,
    audio,
    document: documentAsset,
    batchId: classId ?? undefined,
    dictionaryEnabled,
    questions,
    settings: settingsDraft,
  });
  const minWords = positiveInt(draft.minWords);
  const maxWords = positiveInt(draft.maxWords);
  const rangeInverted = kind.type === 'WRITING_TEST' && minWords !== undefined && maxWords !== undefined && minWords > maxWords;

  const create = useMutation({
    mutationFn: (dto: CreateAssessmentInput) => assessmentsApi.create(dto),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assessments(kind.type) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.exercises });
      setCreated(res);
      setDraft(EMPTY_DRAFT);
      setQuestions([]);
      setSettingsDraft(DEFAULT_SETTINGS_DRAFT);
      setAudio(null);
      setDocumentAsset(null);
      setSelected([]);
      setDueDate('');
    },
  });

  const Icon = kind.icon;
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{kind.label}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{kind.description}</p>
      </div>

      {classId && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <School className="h-5 w-5 shrink-0 text-primary" />
          <div className="flex-1 text-sm">
            <span className="font-medium">
              {linkedClass ? linkedClass.name : 'Class'}
            </span>
            {linkedClass && (
              <span className="text-muted-foreground">
                {' '}· {linkedClass.studentCount} {linkedClass.studentCount === 1 ? 'student' : 'students'}
              </span>
            )}
            {classStudentsLoading && (
              <span className="text-muted-foreground"> · Loading students…</span>
            )}
          </div>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Show all students instead"
            onClick={() => {
              setSearchParams({});
              setSelected([]);
              setAutoSelected(false);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New {kind.label.toLowerCase()}</CardTitle>
            <CardDescription>Students see it under My Assignments within about 30 seconds.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="as-title">Title</Label>
              <Input id="as-title" value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder={TITLE_PLACEHOLDER[kind.type]} maxLength={200} />
            </div>

            {kind.type === 'VOCABULARY_TEST' && (
              <>
                <div className="flex items-center justify-between">
                  <Label>Questions</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowImport(true)} className="gap-1.5">
                    <Upload className="h-3.5 w-3.5" /> Import from word list
                  </Button>
                </div>
                <VocabularyTestBuilder questions={questions} onChange={setQuestions} />
                <ImportQuestionsDialog open={showImport} onOpenChange={setShowImport} onImport={setQuestions} />
                <TestSettingsPanel value={settingsDraft} onChange={setSettingsDraft} questionCount={questions.length} />
              </>
            )}

            {kind.type === 'WRITING_TEST' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="as-prompt">Prompt</Label>
                  <Textarea
                    id="as-prompt"
                    value={draft.prompt}
                    onChange={(e) => set('prompt', e.target.value)}
                    rows={5}
                    maxLength={2000}
                    placeholder="What students are asked to write about"
                    className="resize-none"
                  />
                </div>
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="as-min">Minimum words</Label>
                    <Input id="as-min" type="number" min={1} value={draft.minWords} onChange={(e) => set('minWords', e.target.value)} className="w-32" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="as-max">Maximum words</Label>
                    <Input id="as-max" type="number" min={1} value={draft.maxWords} onChange={(e) => set('maxWords', e.target.value)} className="w-32" />
                  </div>
                </div>
                {rangeInverted && <p className="text-xs text-destructive">The minimum can&apos;t be higher than the maximum.</p>}
              </>
            )}

            {kind.type === 'LISTENING_TEST' && (
              <>
                <div className="space-y-1.5">
                  <Label>Audio clip</Label>
                  <AudioPicker value={audio} onChange={setAudio} />
                </div>
                <QuestionListField
                  id="as-questions"
                  label="Questions (one per line)"
                  value={draft.questions}
                  onChange={(v) => set('questions', v)}
                  placeholder={'Which gate is the flight leaving from? = B12 | A4 | C9\nWhat time does it depart? = 9:30'}
                  hint={QUESTION_HINT.LISTENING_TEST}
                  rows={6}
                />
              </>
            )}

            {kind.type === 'READING_TEST' && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="as-passage">Passage to read aloud {documentAsset && <span className="font-normal text-muted-foreground">(optional — a document is attached below)</span>}</Label>
                    <span className="text-xs text-muted-foreground">{draft.passage.length}/2000</span>
                  </div>
                  <Textarea
                    id="as-passage"
                    value={draft.passage}
                    onChange={(e) => set('passage', e.target.value)}
                    rows={5}
                    maxLength={2000}
                    placeholder="The sentence or paragraph the student will read out loud"
                    className="resize-none text-base leading-relaxed"
                  />
                  <p className="text-xs text-muted-foreground">
                    Students can press “Listen to pronunciation” to hear it first, then record themselves.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Or upload a PDF for students to read (optional)</Label>
                  <DocumentPicker value={documentAsset} onChange={setDocumentAsset} />
                  <p className="text-xs text-muted-foreground">Students open the document on their console and read from it instead of (or alongside) the passage above.</p>
                </div>
              </>
            )}

            {kind.type !== 'VOCABULARY_TEST' && (
              <div className="space-y-1.5">
                <Label htmlFor="as-instructions">Instructions for students (optional)</Label>
                <Textarea id="as-instructions" value={draft.instructions} onChange={(e) => set('instructions', e.target.value)} rows={2} maxLength={1000} className="resize-none" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Students</Label>
              <StudentPicker students={activeStudents} selected={selected} onChange={setSelected} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="as-due">Due date (optional)</Label>
              <Input id="as-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-44" />
            </div>

            {/* Offline dictionary (spec §7) — defaults off for a vocabulary
                test (looking up the answer defeats the test), on for every
                other kind; a teacher can override either way. */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dictionaryEnabled ?? kind.type !== 'VOCABULARY_TEST'}
                onChange={(e) => setDictionaryEnabled(e.target.checked)}
              />
              Allow the dictionary during this test
            </label>

            {create.isError && <p className="text-sm text-destructive">{create.error instanceof Error ? create.error.message : 'Could not create the assignment'}</p>}
            {created && (
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                {created.assigned > 0 ? `Sent to ${created.assigned} ${created.assigned === 1 ? 'student' : 'students'}.` : 'Saved.'}
                <Link to={`/assignments/${kind.slug}/${created.exerciseId}`} className="font-medium underline">
                  {created.assigned > 0 ? 'View results' : 'Open it'}
                </Link>
              </p>
            )}
            <Button
              className="w-full"
              disabled={!input || create.isPending}
              onClick={() => {
                if (!input) return;
                setCreated(null);
                create.mutate(input);
              }}
            >
              {create.isPending
                ? 'Creating…'
                : selected.length === 0
                  ? 'Save test'
                  : `Create & send to ${selected.length} ${selected.length === 1 ? 'student' : 'students'}`}
            </Button>
          </CardContent>
        </Card>

        <AssignmentList kind={kind} />
      </div>
    </div>
  );
}

/** One page per assignment type (/assignments/vocabulary | writing | listening).
 * Keyed by type (and classId when present) so switching between them or
 * changing the target class starts a clean form. */
export function CreateAssignmentPage() {
  const { kind: slug } = useParams<{ kind: string }>();
  const [searchParams] = useSearchParams();
  const classId = searchParams.get('classId') ?? '';
  const kind = kindBySlug(slug);
  if (!kind) return <Navigate to="/assignments/vocabulary" replace />;
  return <CreateAssignmentForm key={`${kind.slug}-${classId}`} kind={kind} />;
}
