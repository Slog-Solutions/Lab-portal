import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, TriangleAlert, Volume2 } from 'lucide-react';
import { Track } from 'livekit-client';
import { translationLanguageLabel, type TranslationCaption } from '@lab/shared';
import {
  TRANSLATION_CAPTIONS_TOPIC,
  TRANSLATION_SOURCE_TRACK,
  isTranslatorIdentity,
  parseTranslationTrackName,
} from '@lab/shared/events';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/layout/Panel';
import { LiveKitRoomClient } from '../../lib/livekit-client';
import { getLiveKitUrl } from '../../lib/runtime-config';
import { translationApi, type TranslationTestRun } from '../../lib/translation-api';

const textDecoder = new TextDecoder();

export interface TestRunMonitorProps {
  run: TranslationTestRun;
  /** Present for a just-started `realtime` run: the room to audition in.
   * Null for a `fast` run or a past run from history, which are played
   * back from their saved output files instead. */
  liveRoom: { room: string; token: string } | null;
}

/**
 * Auditions one test run.
 *
 * For a live `realtime` run this joins the run's own LiveKit room and
 * behaves exactly like a student's console: it subscribes to one
 * language's `tr:<lang>` track at a time (plus the original `src`), mutes
 * the original while a translation is playing, and renders captions from
 * the same data-channel topic. That equivalence is the point — a test
 * that played audio some other way would not tell the teacher what
 * students experience.
 */
export function TestRunMonitor({ run, liveRoom }: TestRunMonitorProps) {
  const [listenLang, setListenLang] = useState<string>(run.langs[0] ?? '');
  const [captions, setCaptions] = useState<TranslationCaption[]>([]);
  const [connected, setConnected] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const roomRef = useRef<LiveKitRoomClient | null>(null);
  const listenLangRef = useRef(listenLang);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Connect once per live run. Keyed on the room name so switching to a
  // different run tears the old connection down.
  useEffect(() => {
    if (!liveRoom) {
      setConnected(false);
      return;
    }
    let cancelled = false;
    const client = new LiveKitRoomClient({
      onTrackSubscribed: (handle) => {
        if (handle.track.kind !== Track.Kind.Audio || !audioContainerRef.current) return;
        const el = handle.track.attach() as HTMLAudioElement;
        el.dataset.trackName = handle.trackName;
        const lang = parseTranslationTrackName(handle.trackName);
        // Muted before it enters the document, so the original never
        // leaks a moment of untranslated audio under the translation.
        el.muted = lang === null ? listenLangRef.current !== '' : lang !== listenLangRef.current;
        audioElsRef.current.set(handle.trackName, el);
        audioContainerRef.current.appendChild(el);
      },
      onTrackUnsubscribed: (handle) => {
        handle.track.detach().forEach((el) => el.remove());
        audioElsRef.current.delete(handle.trackName);
      },
      onDataReceived: (payload, topic) => {
        if (topic !== TRANSLATION_CAPTIONS_TOPIC) return;
        try {
          const caption = JSON.parse(textDecoder.decode(payload)) as TranslationCaption;
          setCaptions((prev) => {
            const next = [...prev.filter((c) => !(c.segId === caption.segId && c.lang === caption.lang)), caption];
            return next.length > 400 ? next.slice(-400) : next;
          });
        } catch {
          // Ignore a malformed caption rather than failing the audition.
        }
      },
      onAudioPlaybackChanged: (canPlay) => setPlaybackBlocked(!canPlay),
      onDisconnected: () => setConnected(false),
      // The original plus exactly one translation, same as a student.
      subscriptionFilter: (info) => {
        if (!isTranslatorIdentity(info.participantIdentity)) return true;
        if (info.trackName === TRANSLATION_SOURCE_TRACK) return true;
        const lang = parseTranslationTrackName(info.trackName);
        return lang !== null && lang === listenLangRef.current;
      },
    });

    void client
      .connect(getLiveKitUrl(), liveRoom.token)
      .then(() => {
        if (cancelled) {
          void client.disconnect();
          return;
        }
        roomRef.current = client;
        setConnected(true);
        setPlaybackBlocked(!client.room.canPlaybackAudio);
      })
      .catch((err: unknown) => {
        if (!cancelled) setConnectError(err instanceof Error ? err.message : 'Could not join the test room');
      });

    const attachedEls = audioElsRef.current;
    return () => {
      cancelled = true;
      void client.disconnect();
      roomRef.current = null;
      attachedEls.clear();
    };
    // Keyed on the room identity, not the `liveRoom` object: a new object
    // with the same room/token (a re-render of the parent) must not tear
    // down a connection that is mid-audition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRoom?.room, liveRoom?.token]);

  // Switching language re-runs the filter and re-applies muting, exactly
  // as the student console does.
  useEffect(() => {
    listenLangRef.current = listenLang;
    roomRef.current?.refreshSubscriptions();
    for (const [trackName, el] of audioElsRef.current) {
      const lang = parseTranslationTrackName(trackName);
      el.muted = lang === null ? listenLang !== '' : lang !== listenLang;
    }
  }, [listenLang]);

  const visibleCaptions = useMemo(
    () => captions.filter((c) => c.lang === listenLang).sort((a, b) => a.segId - b.segId).slice(-12),
    [captions, listenLang],
  );

  const metrics = run.metrics?.langs?.[listenLang];
  const inFlight = run.status === 'queued' || run.status === 'running';

  return (
    <Panel>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">{run.fileName}</h2>
          {inFlight && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              {liveRoom ? 'Playing in real time…' : 'Processing…'}
            </span>
          )}
          {run.status === 'failed' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-status-pending">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
              {run.error ?? 'Run failed'}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="monitor-lang">
              Listen in
            </label>
            <NativeSelect
              id="monitor-lang"
              compact
              className="w-44"
              value={listenLang}
              onChange={(e) => setListenLang(e.target.value)}
            >
              <option value="">Original only</option>
              {run.langs.map((code) => (
                <option key={code} value={code}>
                  {translationLanguageLabel(code)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        {connectError && <p className="text-xs text-status-pending">{connectError}</p>}
        {playbackBlocked && connected && (
          <Button type="button" size="sm" onClick={() => void roomRef.current?.startAudio()}>
            <Volume2 className="mr-1.5 h-4 w-4" />
            Enable audio
          </Button>
        )}

        {/* Live captions while the run plays. */}
        {liveRoom && listenLang && (
          <div className="max-h-48 overflow-y-auto rounded-control bg-brand-soft px-3 py-2 text-sm leading-relaxed" aria-live="polite">
            {visibleCaptions.length === 0 ? (
              <span className="text-muted-foreground">Captions will appear here as the clip plays.</span>
            ) : (
              visibleCaptions.map((c) => (
                <p key={c.segId} className={c.final ? '' : 'text-muted-foreground'}>
                  {c.text}
                </p>
              ))
            )}
          </div>
        )}

        {/* Latency summary — the reason this page exists. */}
        {run.status === 'done' && (
          <div className="space-y-3">
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Metric label="Caption lag (p50)" value={fmtMs(metrics?.captionLagP50)} />
              <Metric label="Caption lag (p95)" value={fmtMs(metrics?.captionLagP95)} />
              <Metric label="Speech lag (p95)" value={fmtMs(metrics?.speechLagP95)} />
              <Metric
                label="Real-time factor"
                value={run.metrics?.rtf !== undefined ? run.metrics.rtf.toFixed(2) : '—'}
                hint="GPU seconds per second of audio. Under 1.0 means the engine keeps up."
              />
              <Metric label="Segments" value={metrics?.segments !== undefined ? String(metrics.segments) : '—'} />
            </dl>

            {(run.files ?? []).length > 0 && <SavedOutputs run={run} />}

            {metrics?.transcript && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Full transcript ({translationLanguageLabel(listenLang)})</summary>
                <p className="mt-2 whitespace-pre-wrap leading-relaxed">{metrics.transcript}</p>
              </details>
            )}
          </div>
        )}
      </div>
      <div ref={audioContainerRef} className="hidden" />
    </Panel>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function fmtMs(ms?: number): string {
  return ms === undefined ? '—' : `${(ms / 1000).toFixed(2)}s`;
}

/** Saved per-language WAVs, played from a blob URL since an authenticated
 * download cannot go in an <audio src>. */
function SavedOutputs({ run }: { run: TranslationTestRun }) {
  const wavs = (run.files ?? []).filter((f) => f.endsWith('.wav'));
  if (wavs.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground">Saved output</h3>
      {wavs.map((fileName) => (
        <SavedOutput key={fileName} runId={run.id} fileName={fileName} />
      ))}
    </div>
  );
}

function SavedOutput({ runId, fileName }: { runId: string; fileName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    translationApi
      .fetchFileBlob(runId, fileName)
      .then((objectUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        created = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [runId, fileName]);

  const label = fileName.replace(/\.wav$/, '');
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs">
        {label === 'src' ? 'Original' : translationLanguageLabel(label)}
      </span>
      {failed ? (
        <span className="text-xs text-status-pending">Could not load</span>
      ) : url ? (
        <audio controls src={url} className="h-9 flex-1" />
      ) : (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}
