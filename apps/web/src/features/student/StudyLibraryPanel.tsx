import { useState } from 'react';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { VocabularyTestPlayer } from '../activities/VocabularyTestPlayer';
import { ContentExercisePlayer } from '../activities/ContentExercisePlayer';
import { PronunciationPlayer } from '../activities/PronunciationPlayer';
import { StudyMaterialItem } from './StudyMaterialItem';
import { useStudyLibrary } from './use-study-library';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Annexure-I Ser 1: "content management library... self-study even when
 * teacher not present" / Ser 10 "CEFR-aligned worksheets across 4 key
 * skills". Deliberately separate from AssignmentsPanel: an Assignment is a
 * teacher targeting a specific student with a target score/deadline (Ser
 * 10 "teacher-tailored courses"), while a StudyModule is a curated
 * catalogue anyone can browse and practise from at any time. Both panels
 * launch the exact same exercise players because both ultimately start a
 * plain Attempt (attempts.service.ts doesn't distinguish "why" an attempt
 * started, only what exercise it's for).
 *
 * StudentConsole only mounts this panel once a student has signed in at
 * this seat (see StudentSignInScreen), and it is now its own drawer
 * section (so an empty library shows an explanation rather than hiding the
 * panel). The station has therefore always already claimed a
 * student by the time this renders — starting an exercise here can rely
 * on control.getToken() being valid, the same station token AssignmentsPanel
 * uses (see attempts.controller.ts's doc comment on why /attempts/* stays
 * station-authenticated rather than switching to the student's own JWT).
 */
export function StudyLibraryPanel({ control, active }: { control: StationControlClient; active: boolean }) {
  const [started, setStarted] = useState<StartedAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const library = useStudyLibrary(control, { active, paused: started !== null });
  const modules = library.data?.modules;
  const files = library.data?.files;

  async function startExercise(exerciseId: string): Promise<void> {
    setError(null);
    try {
      const res = await stationApi.startAttempt(control.getToken(), { exerciseId });
      setStarted(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start exercise');
    }
  }

  function onDone(): void {
    setStarted(null);
  }

  if (started) {
    switch (started.exercise.type) {
      case 'VOCABULARY_TEST':
        return <VocabularyTestPlayer control={control} started={started} onDone={onDone} />;
      case 'CONTENT_EXERCISE':
        return <ContentExercisePlayer control={control} started={started} onDone={onDone} />;
      case 'PRONUNCIATION':
        return <PronunciationPlayer control={control} started={started} onDone={onDone} />;
      default:
        return <p className="text-sm text-muted-foreground">{started.exercise.type} has no self-paced player.</p>;
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Study Material</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {library.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {/* A failed refresh keeps showing the last list; only a first load that
            never succeeded says so, instead of claiming the library is empty. */}
        {library.isError && !modules && (
          <p className="text-sm text-amber-500">Could not load the study material — check your connection or tell your teacher.</p>
        )}
        {modules?.length === 0 && files?.length === 0 && (
          <p className="text-sm text-muted-foreground">No study material yet. Your teacher hasn't published any modules or files.</p>
        )}
        {modules?.map((mod) => (
          <div key={mod.id}>
            <p className="mb-1.5 text-sm font-medium">{mod.title}</p>
            {mod.description && (
              <div className="mb-2 rounded-md border border-border bg-muted/30 p-2.5">
                <p className="mb-0.5 text-xs font-medium text-muted-foreground">How to use this</p>
                <p className="whitespace-pre-wrap text-sm">{mod.description}</p>
              </div>
            )}
            <div className="space-y-1.5">
              {mod.exercises.map((ex) => (
                <div key={ex.id} className="flex items-center justify-between rounded-md border border-border p-2">
                  <div>
                    <p className="text-sm">{ex.title}</p>
                    <p className="text-xs text-muted-foreground">{ex.type}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => void startExercise(ex.id)}>
                    Practise
                  </Button>
                </div>
              ))}
              {mod.materials.map((material) => (
                <StudyMaterialItem key={material.id} material={material} token={control.getToken()} />
              ))}
              {mod.exercises.length === 0 && mod.materials.length === 0 && (
                <p className="text-xs text-muted-foreground">Nothing in this module yet.</p>
              )}
            </div>
          </div>
        ))}
        {files && files.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium">Files from your teachers</p>
            <div className="space-y-1.5">
              {files.map((file) => (
                <StudyMaterialItem key={file.id} material={file} token={control.getToken()} />
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
