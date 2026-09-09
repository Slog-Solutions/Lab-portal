import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ActivityType } from '@lab/shared';
import { exercisesApi } from '../../lib/exercises-api';
import { contentPackagesApi } from '../../lib/content-packages-api';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

// The three assessment types this pass builds real authoring for. Other
// registered ActivityTypes (round table, telephone, ...) are authored
// through the Session Builder instead — see SessionBuilderPage.
const ASSESSMENT_TYPES = [ActivityType.VOCABULARY_TEST, ActivityType.CONTENT_EXERCISE, ActivityType.PRONUNCIATION];

export function ExercisesPage() {
  const queryClient = useQueryClient();
  const { data: exercises, isLoading } = useQuery({ queryKey: queryKeys.exercises, queryFn: exercisesApi.list });
  const { data: packages } = useQuery({ queryKey: queryKeys.contentPackages, queryFn: contentPackagesApi.list });

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>(ActivityType.VOCABULARY_TEST);
  const [title, setTitle] = useState('');
  const [gradeLevel, setGradeLevel] = useState('A1');
  const [contentPackageId, setContentPackageId] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [voice, setVoice] = useState<'en_US' | 'en_GB'>('en_GB');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      let config: unknown;
      if (type === ActivityType.VOCABULARY_TEST) {
        // Placeholder single item so zVocabularyTestConfig validates —
        // the real bank is built on the detail page via word-list import
        // or manual entry, then "Enable test-bank sampling" switches this
        // config over to itemBankId mode.
        config = { items: [{ prompt: title, answer: '(edit on the exercise page)' }], shuffleItems: true };
      } else if (type === ActivityType.CONTENT_EXERCISE) {
        config = { contentPackageId, gradeLevel };
      } else {
        config = { sourceText, voice };
      }
      return exercisesApi.create({ type: type as never, title, config });
    },
    onSuccess: () => {
      setOpen(false);
      setTitle('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.exercises });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create exercise'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Exercises</h1>
          <p className="text-sm text-muted-foreground">Vocabulary tests, content exercises and pronunciation activities.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New Exercise</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Exercise</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSESSMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>

              {type === ActivityType.CONTENT_EXERCISE && (
                <>
                  <div className="space-y-1.5">
                    <Label>Content Package</Label>
                    <Select value={contentPackageId} onValueChange={setContentPackageId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a package" />
                      </SelectTrigger>
                      <SelectContent>
                        {packages?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Grade / CEFR level</Label>
                    <Input value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} />
                  </div>
                </>
              )}

              {type === ActivityType.PRONUNCIATION && (
                <>
                  <div className="space-y-1.5">
                    <Label>Source text</Label>
                    <Input value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder="Text the student will pronounce" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Voice</Label>
                    <Select value={voice} onValueChange={(v) => setVoice(v as 'en_US' | 'en_GB')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en_GB">en_GB</SelectItem>
                        <SelectItem value="en_US">en_US</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {type === ActivityType.VOCABULARY_TEST && (
                <p className="text-xs text-muted-foreground">
                  Items are added on the next page (manual entry or word-list import).
                </p>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                onClick={() => create.mutate()}
                disabled={create.isPending || !title || (type === ActivityType.CONTENT_EXERCISE && !contentPackageId)}
              >
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exercises?.map((ex) => (
                  <TableRow key={ex.id}>
                    <TableCell>
                      <Link to={`/exercises/${ex.id}`} className="font-medium text-primary hover:underline">
                        {ex.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ex.type}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{ex.itemBank?._count.items ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(ex.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
