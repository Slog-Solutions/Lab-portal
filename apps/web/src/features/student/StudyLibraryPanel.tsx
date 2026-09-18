import { useEffect, useState } from 'react';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { VocabularyTestPlayer } from '../activities/VocabularyTestPlayer';
import { ContentExercisePlayer } from '../activities/ContentExercisePlayer';
import { PronunciationPlayer } from '../activities/PronunciationPlayer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type LibraryModule = Awaited<ReturnType<typeof stationApi.studyLibrary>>[number];

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
 * Since the student sign-in gate was added, StudentConsole only mounts
 * this panel once a student has signed in at this seat (see
 * StudentSignInScreen), so the station has always already claimed a
 * student by the time this renders — starting an exercise here can rely
 * on control.getToken() being valid, the same station token AssignmentsPanel
 * uses (see attempts.controller.ts's doc comment on why /attempts/* stays
 * station-authenticated rather than switching to the student's own JWT).
 */
export function StudyLibraryPanel({ control }: { control: StationControlClient }) {
  const [modules, setModules] = useState<LibraryModule[] | null>(null);
  const [started, setStarted] = useState<StartedAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    stationApi
      .studyLibrary(control.getToken())
      .then(setModules)
      .catch(() => setModules([]));
  }, [control]);

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

  if (modules === null || modules.length === 0) return null; // nothing to show yet — don't clutter the console with an empty library

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Study Library</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {modules.map((mod) => (
          <div key={mod.id}>
            <p className="mb-1.5 text-sm font-medium">{mod.title}</p>
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
              {mod.exercises.length === 0 && <p className="text-xs text-muted-foreground">No exercises in this module yet.</p>}
            </div>
          </div>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
