import { useEffect, useRef, useState } from 'react';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { getRuntimeConfig } from '../../lib/runtime-config';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ContentPackageMeta {
  id: string;
  entryPoint: string;
  format: string;
}

/**
 * Ser 4 "Content Exercise" — launches an imported SCORM/xAPI/HTML package
 * (content/content-packages.service.ts) in an iframe and implements the
 * client-side half of the SCORM API: a package's own JS calls
 * `findAPI()`, which walks up the `window.parent` chain looking for an
 * object literally named `API` (1.2) or `API_1484_11` (2004) — the
 * standard SCORM convention. Installing that object on THIS window before
 * the iframe loads is the whole "RTE", by design (see
 * content-packages.service.ts's doc comment on why a server-side data
 * model is out of scope): no package files are modified, nothing server-
 * side needs to understand SCORM's runtime protocol, and a package that
 * calls LMSSetValue('cmi.core.score.raw', ...) genuinely gets graded.
 */
export function ContentExercisePlayer({
  control,
  started,
  onDone,
}: {
  control: StationControlClient;
  started: StartedAttempt;
  onDone: () => void;
}) {
  const config = started.exercise.config as { contentPackageId: string };
  const [pkg, setPkg] = useState<ContentPackageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<{ score: number; status: string } | null>(null);
  const scoreRef = useRef<{ raw: string | null; status: string | null }>({ raw: null, status: null });
  const submittedRef = useRef(false);

  useEffect(() => {
    const { serverUrl } = getRuntimeConfig();
    const token = control.getToken();

    async function submitFinal(): Promise<void> {
      if (submittedRef.current) return;
      submittedRef.current = true;
      const score = scoreRef.current.raw !== null ? Number(scoreRef.current.raw) : 0;
      try {
        await stationApi.submitAttempt(token, started.attemptId, {
          response: { score: Number.isFinite(score) ? score : 0, itemResults: [] },
        });
        setFinished({ score, status: scoreRef.current.status ?? 'completed' });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit');
      }
    }

    // SCORM 1.2
    (window as unknown as Record<string, unknown>).API = {
      LMSInitialize: () => 'true',
      LMSGetValue: (key: string) => (key === 'cmi.core.score.raw' ? (scoreRef.current.raw ?? '') : ''),
      LMSSetValue: (key: string, value: string) => {
        if (key === 'cmi.core.score.raw') scoreRef.current.raw = value;
        if (key === 'cmi.core.lesson_status') scoreRef.current.status = value;
        return 'true';
      },
      LMSCommit: () => 'true',
      LMSFinish: () => {
        void submitFinal();
        return 'true';
      },
      LMSGetLastError: () => '0',
      LMSGetErrorString: () => '',
      LMSGetDiagnostic: () => '',
    };
    // SCORM 2004
    (window as unknown as Record<string, unknown>).API_1484_11 = {
      Initialize: () => 'true',
      GetValue: (key: string) => (key === 'cmi.score.raw' ? (scoreRef.current.raw ?? '') : ''),
      SetValue: (key: string, value: string) => {
        if (key === 'cmi.score.raw') scoreRef.current.raw = value;
        if (key === 'cmi.completion_status') scoreRef.current.status = value;
        return 'true';
      },
      Commit: () => 'true',
      Terminate: () => {
        void submitFinal();
        return 'true';
      },
      GetLastError: () => '0',
      GetErrorString: () => '',
      GetDiagnostic: () => '',
    };

    fetch(`${serverUrl}/api/content-packages/${config.contentPackageId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load content package (${res.status})`);
        return res.json();
      })
      .then((meta: ContentPackageMeta) => setPkg(meta))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load content package'));

    return () => {
      delete (window as unknown as Record<string, unknown>).API;
      delete (window as unknown as Record<string, unknown>).API_1484_11;
    };
  }, [control, config.contentPackageId, started.attemptId]);

  if (error) {
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (finished) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{started.exercise.title} — Completed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-2xl font-semibold">{finished.score}%</p>
          <Button onClick={onDone}>Back to assignments</Button>
        </CardContent>
      </Card>
    );
  }

  if (!pkg) {
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-muted-foreground">Loading content…</CardContent>
      </Card>
    );
  }

  const { serverUrl } = getRuntimeConfig();
  const src = `${serverUrl}/api/content-packages/${pkg.id}/files/${pkg.entryPoint}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{started.exercise.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <iframe title={started.exercise.title} src={src} className="h-[70vh] w-full rounded-md border border-border bg-white" />
        <p className="mt-2 text-xs text-muted-foreground">
          Complete the content in the frame above — it reports your score automatically when finished.
        </p>
      </CardContent>
    </Card>
  );
}
