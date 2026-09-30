import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CourseSpeech } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi } from '../../lib/station-api';
import { base64ToAudioUrl } from '../../lib/pronunciation-api';

interface Voiced {
  url: string | null;
  ipa: string | null;
}

/** Shared across every course player on this seat, so a word heard in one
 * activity plays instantly in the next. Object URLs live for the page. */
const voicedCache = new Map<string, Promise<Voiced>>();

/**
 * Voices course text through the offline pipeline (POST /pronunciation/speak
 * — Piper audio + eSpeak-NG IPA, disk-cached server-side) and plays a list of
 * lines one after another, e.g. a dialogue's speakers in turn. `rate` slows
 * playback for "listen again, slowly" without re-synthesizing.
 */
export function useCourseSpeech(control: StationControlClient) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const runRef = useRef(0);

  const voice = useCallback(
    (line: CourseSpeech): Promise<Voiced> => {
      const key = `${line.voice ?? 'en_GB'}|${line.text}`;
      let hit = voicedCache.get(key);
      if (!hit) {
        hit = stationApi.speakPronunciation(control.getToken(), line.text, line.voice ?? 'en_GB').then((res) => ({
          url: res.audioBase64 ? base64ToAudioUrl(res.audioBase64) : null,
          ipa: res.ipa,
        }));
        hit.catch(() => voicedCache.delete(key));
        voicedCache.set(key, hit);
      }
      return hit;
    },
    [control],
  );

  const stop = useCallback(() => {
    runRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  }, []);

  /** Plays the lines in order; resolves when done (or when superseded).
   * `onLine` reports which line is sounding, for highlighting. */
  const play = useCallback(
    async (lines: CourseSpeech[], opts: { id?: string; rate?: number; gapMs?: number; onLine?: (index: number) => void } = {}): Promise<void> => {
      stop();
      const run = runRef.current;
      setError(null);
      setPlaying(opts.id ?? lines.map((l) => l.text).join(' '));
      // Start every synthesis at once; play strictly in order.
      const voiced = lines.map((l) => voice(l));
      try {
        for (let i = 0; i < lines.length; i++) {
          const v = await voiced[i]!;
          if (run !== runRef.current) return;
          if (!v.url) {
            setError('The model voice is not available on this server.');
            continue;
          }
          opts.onLine?.(i);
          await new Promise<void>((resolve) => {
            const audio = new Audio(v.url!);
            audio.playbackRate = opts.rate ?? 1;
            audioRef.current = audio;
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
            audio.onpause = () => resolve();
            void audio.play().catch(() => resolve());
          });
          if (run !== runRef.current) return;
          if (opts.gapMs && i < lines.length - 1) await new Promise((r) => setTimeout(r, opts.gapMs));
        }
      } catch (err) {
        if (run === runRef.current) setError(err instanceof Error ? err.message : 'Could not play the audio');
      } finally {
        if (run === runRef.current) setPlaying(null);
      }
    },
    [stop, voice],
  );

  /** IPA for a word/phrase (null when eSpeak-NG isn't installed). */
  const ipa = useCallback(async (text: string) => (await voice({ text })).ipa, [voice]);

  /** Warm the cache for what is coming next. */
  const prefetch = useCallback((lines: CourseSpeech[]) => lines.forEach((l) => void voice(l).catch(() => undefined)), [voice]);

  useEffect(() => () => stop(), [stop]);

  // Stable identity (per playing/error change), so players can safely list it in effect deps.
  return useMemo(() => ({ play, stop, playing, error, ipa, prefetch }), [play, stop, playing, error, ipa, prefetch]);
}

export type CourseSpeechApi = ReturnType<typeof useCourseSpeech>;
