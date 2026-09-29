import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRole } from '@lab/shared';
import { AlertTriangle, CheckCircle2, ChevronRight, ClipboardCheck, Loader2 } from 'lucide-react';
import { pronunciationApi, type PronunciationVoice } from '../../lib/pronunciation-api';
import { usersApi } from '../../lib/users-api';
import { queryKeys } from '../../lib/query-keys';
import { StudentPicker } from './StudentPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const MAX_WORDS = 50;
const MAX_WORD_LENGTH = 100;

/** One word per line; blank lines dropped, repeats (any case) collapsed —
 * the same normalisation the server applies, so the count shown here is
 * the count that will be created. */
function parseWords(text: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const line of text.split('\n')) {
    const word = line.trim();
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    words.push(word);
  }
  return words;
}

/** Ser 7 — teacher-run pronunciation tests: give a list of words, pick the
 * students, and each student records themselves saying every word from
 * their own console. Grading happens on the results page. */
export function PronunciationTestsPage() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({ queryKey: queryKeys.pronunciationStatus, queryFn: pronunciationApi.status, staleTime: 60_000 });
  const { data: students } = useQuery({ queryKey: queryKeys.users(UserRole.STUDENT), queryFn: () => usersApi.list(UserRole.STUDENT) });
  const { data: tests, isLoading: testsLoading } = useQuery({ queryKey: queryKeys.pronunciationTests, queryFn: pronunciationApi.tests.list });

  const [title, setTitle] = useState('');
  const [wordsText, setWordsText] = useState('');
  const [instructions, setInstructions] = useState('');
  const [playModelAudio, setPlayModelAudio] = useState(false);
  const [voice, setVoice] = useState<PronunciationVoice>('en_GB');
  const [selected, setSelected] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [created, setCreated] = useState<{ exerciseId: string; wordCount: number; assigned: number } | null>(null);

  const words = parseWords(wordsText);
  const voiceUnavailable = status !== undefined && !status.voice;
  const activeStudents = (students ?? []).filter((s) => s.active);
  const tooLong = words.some((w) => w.length > MAX_WORD_LENGTH);
  const canCreate = title.trim().length > 0 && words.length > 0 && words.length <= MAX_WORDS && !tooLong && selected.length > 0;

  const create = useMutation({
    mutationFn: () =>
      pronunciationApi.tests.create({
        title: title.trim(),
        words,
        instructions: instructions.trim() || undefined,
        playModelAudio: playModelAudio && !voiceUnavailable,
        voice,
        studentIds: selected,
        dueAt: dueDate ? new Date(`${dueDate}T23:59:59`).toISOString() : undefined,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pronunciationTests });
      void queryClient.invalidateQueries({ queryKey: queryKeys.exercises });
      setCreated(res);
      setTitle('');
      setWordsText('');
      setInstructions('');
      setSelected([]);
      setDueDate('');
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Pronunciation Tests</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Give a list of words. Each student records themselves saying every word from their own console; you listen and rate each one.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New test</CardTitle>
            <CardDescription>Students see the test under My Assignments within about 30 seconds.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pt-title">Title</Label>
              <Input id="pt-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder='e.g. "Unit 3 — tricky vowels"' maxLength={200} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="pt-words">Words (one per line)</Label>
                <span className={`text-xs ${words.length > MAX_WORDS ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {words.length}/{MAX_WORDS}
                </span>
              </div>
              <Textarea
                id="pt-words"
                value={wordsText}
                onChange={(e) => setWordsText(e.target.value)}
                rows={6}
                placeholder={'thorough\nrural\nwomen'}
                className="resize-none text-base"
              />
              {tooLong && <p className="text-xs text-destructive">Each word can be at most {MAX_WORD_LENGTH} characters.</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pt-instructions">Instructions for students (optional)</Label>
              <Textarea id="pt-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} maxLength={500} className="resize-none" />
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={playModelAudio && !voiceUnavailable} disabled={voiceUnavailable} onCheckedChange={(c) => setPlayModelAudio(c === true)} />
                Let students hear each word before recording
              </label>
              {voiceUnavailable && (
                <p className="flex items-start gap-1.5 text-xs text-status-pending">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  The model voice (Piper) isn&apos;t configured on this server, so students can only see the words.
                </p>
              )}
              {playModelAudio && !voiceUnavailable && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="pt-voice" className="text-xs text-muted-foreground">
                    Voice
                  </Label>
                  <select
                    id="pt-voice"
                    value={voice}
                    onChange={(e) => setVoice(e.target.value as PronunciationVoice)}
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="en_GB">British</option>
                    <option value="en_US">American</option>
                  </select>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Students</Label>
              <StudentPicker students={activeStudents} selected={selected} onChange={setSelected} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pt-due">Due date (optional)</Label>
              <Input id="pt-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-44" />
            </div>

            {create.isError && <p className="text-sm text-destructive">{create.error instanceof Error ? create.error.message : 'Could not create the test'}</p>}
            {created && (
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-status-online">
                <CheckCircle2 className="h-4 w-4" />
                Test sent to {created.assigned} {created.assigned === 1 ? 'student' : 'students'} ({created.wordCount} words).
                <Link to={`/pronunciation-tests/${created.exerciseId}`} className="font-medium underline">
                  View results
                </Link>
              </p>
            )}
            <Button
              className="w-full"
              disabled={!canCreate || create.isPending}
              onClick={() => {
                setCreated(null);
                create.mutate();
              }}
            >
              {create.isPending ? 'Creating…' : `Create test & send to ${selected.length} ${selected.length === 1 ? 'student' : 'students'}`}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your tests</CardTitle>
            <CardDescription>Open a test to hear the recordings and grade them.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {testsLoading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : !tests || tests.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">No pronunciation tests yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Test</TableHead>
                    <TableHead>Words</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Graded</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tests.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <p className="font-medium">{t.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.teacherName} · {new Date(t.createdAt).toLocaleDateString()}
                        </p>
                      </TableCell>
                      <TableCell>{t.wordCount}</TableCell>
                      <TableCell>
                        {t.submitted}/{t.assigned}
                      </TableCell>
                      <TableCell>
                        {t.submitted - t.graded > 0 ? (
                          <Badge variant="warning">{t.submitted - t.graded} to grade</Badge>
                        ) : (
                          <span className="text-sm">
                            {t.graded}/{t.assigned}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link to={`/pronunciation-tests/${t.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
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
      </div>
    </div>
  );
}
