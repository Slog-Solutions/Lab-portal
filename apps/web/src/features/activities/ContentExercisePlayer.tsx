import { useEffect, useRef, useState } from 'react';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { getRuntimeConfig } from '../../lib/runtime-config';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ItemResult {
  itemId: string;
  correct: boolean;
  prompt?: string;
  given?: string;
  expected?: string;
}

/** cmi.interactions.3.student_response = "x" → interactions[3].student_response. */
function recordInteraction(store: Map<number, Record<string, string>>, key: string, value: string): void {
  const m = /^cmi\.interactions\.(\d+)\.(.+)$/.exec(key);
  if (!m) return;
  const n = Number(m[1]);
  if (n > 500) return;
  const row = store.get(n) ?? {};
  row[m[2]!] = String(value).slice(0, 1000);
  store.set(n, row);
}

function interactionsToItems(store: Map<number, Record<string, string>>): ItemResult[] {
  return [...store.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, r]) => {
      const item: ItemResult = { itemId: (r.id || `q${n + 1}`).slice(0, 200), correct: (r.result ?? '').toLowerCase() === 'correct' };
      if (r.description) item.prompt = r.description;
      const given = r.student_response ?? r.learner_response;
      if (given !== undefined) item.given = given;
      if (r['correct_responses.0.pattern']) item.expected = r['correct_responses.0.pattern'];
      return item;
    });
}

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
  const [finished, setFinished] = useState<{ score: number; status: string; items: ItemResult[]; reported: boolean } | null>(null);
  const scoreRef = useRef<{ raw: string | null; status: string | null }>({ raw: null, status: null });
  // cmi.interactions.N.* as the package reports them (Ser 4 report tool:
  // "a detailed listing of student scores" — per question, not just a total).
  const interactionsRef = useRef<Map<number, Record<string, string>>>(new Map());
  const submittedRef = useRef(false);
  const submitRef = useRef<() => Promise<void>>(async () => undefined);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const { serverUrl } = getRuntimeConfig();
    const token = control.getToken();

    async function submitFinal(): Promise<void> {
      if (submittedRef.current) return;
      submittedRef.current = true;
      const reported = scoreRef.current.raw !== null;
      const parsed = reported ? Number(scoreRef.current.raw) : 0;
      const score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
      const items = interactionsToItems(interactionsRef.current);
      try {
        await stationApi.submitAttempt(token, started.attemptId, { response: { score, itemResults: items } });
        setFinished({ score, status: scoreRef.current.status ?? 'completed', items, reported });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit');
      }
    }

    // SCORM 1.2
    submitRef.current = submitFinal;
    const interactionCount = () => String(interactionsRef.current.size);

    (window as unknown as Record<string, unknown>).API = {
      LMSInitialize: () => 'true',
      LMSGetValue: (key: string) =>
        key === 'cmi.core.score.raw' ? (scoreRef.current.raw ?? '') : key === 'cmi.interactions._count' ? interactionCount() : '',
      LMSSetValue: (key: string, value: string) => {
        if (key === 'cmi.core.score.raw') scoreRef.current.raw = value;
        if (key === 'cmi.core.lesson_status') scoreRef.current.status = value;
        recordInteraction(interactionsRef.current, key, value);
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
      GetValue: (key: string) =>
        key === 'cmi.score.raw' ? (scoreRef.current.raw ?? '') : key === 'cmi.interactions._count' ? interactionCount() : '',
      SetValue: (key: string, value: string) => {
        if (key === 'cmi.score.raw') scoreRef.current.raw = value;
        if (key === 'cmi.score.scaled' && scoreRef.current.raw === null) scoreRef.current.raw = String(Number(value) * 100);
        if (key === 'cmi.completion_status') scoreRef.current.status = value;
        recordInteraction(interactionsRef.current, key, value);
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

    // Content served from another origin than this page (an Electron seat
    // runs app://, the lab server is http://) can't reach window.API
    // directly; lab-exercise.js then sends the same calls by postMessage.
    // Only this exercise's own frame is listened to, and only these calls.
    const bridged = new Set(['LMSInitialize', 'LMSSetValue', 'LMSCommit', 'LMSFinish']);
    function onMessage(event: MessageEvent): void {
      const data = event.data as { source?: string; method?: string; args?: unknown[] } | null;
      if (!data || data.source !== 'lab-exercise' || event.source !== frameRef.current?.contentWindow) return;
      if (!data.method || !bridged.has(data.method)) return;
      const api = (window as unknown as { API?: Record<string, (...args: string[]) => string> }).API;
      api?.[data.method]?.(...(data.args ?? []).map(String));
    }
    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('message', onMessage);
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
          {finished.reported ? (
            <p className="text-2xl font-semibold">{finished.score}%</p>
          ) : (
            <p className="text-sm text-muted-foreground">Your work has been handed in. Your teacher will give it a score.</p>
          )}
          {finished.items.length > 0 && (
            <ol className="space-y-1 text-sm">
              {finished.items.map((item, i) => (
                <li key={`${item.itemId}-${i}`} className={item.correct ? 'text-status-online' : 'text-destructive'}>
                  {item.correct ? '✓' : '✗'} {item.prompt ?? item.itemId}
                  {item.given ? <span className="text-muted-foreground"> — you: {item.given}</span> : null}
                  {!item.correct && item.expected ? <span className="text-muted-foreground"> · answer: {item.expected}</span> : null}
                </li>
              ))}
            </ol>
          )}
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
        <iframe ref={frameRef} title={started.exercise.title} src={src} className="h-[70vh] w-full rounded-md border border-border bg-white" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Work through the content above. Most exercises send your score automatically when you check your answers; if not, press
            &quot;I&apos;ve finished&quot;.
          </p>
          <Button size="sm" variant="outline" onClick={() => void submitRef.current()}>
            I&apos;ve finished
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
