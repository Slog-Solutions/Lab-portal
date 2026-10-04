import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Headphones, Languages, Loader2, TriangleAlert } from 'lucide-react';
import { DEFAULT_TRANSLATION_LANGUAGE, findTranslationLanguage, translationLanguageLabel } from '@lab/shared';
import type { TranslationStatusPayload } from '@lab/shared/events';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { translationApi } from '../../lib/translation-api';
import { getControlSocket } from '../../lib/socket-client';
import { queryKeys } from '../../lib/query-keys';

export interface TranslationControlProps {
  classId: string;
  /** Which translated language the teacher is currently auditioning, or
   * null. Owned by BroadcastPanel because it drives that room's
   * subscription filter — the teacher must never auto-play translator
   * tracks, or their speakers feed straight back into their own mic and
   * into the translator's input. */
  monitorLang: string | null;
  onMonitorLangChange: (lang: string | null) => void;
}

/**
 * The teacher's live-translation row: the per-class toggle, which
 * language they are speaking, per-language status as students experience
 * it, and an opt-in monitor.
 *
 * Status arrives over the existing `translation:status` dashboard event
 * (pushed every couple of seconds while translation is on) with one REST
 * read on mount to cover the gap before the first push. The teacher sees
 * degradation as it happens instead of hearing about it from a student.
 */
export function TranslationControl({ classId, monitorLang, onMonitorLangChange }: TranslationControlProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TranslationStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const languages = useQuery({
    queryKey: queryKeys.translationLanguages,
    queryFn: translationApi.languages,
    staleTime: 5 * 60_000,
  });

  // One read on mount, then live pushes take over.
  const initial = useQuery({
    queryKey: queryKeys.translationClassStatus(classId),
    queryFn: () => translationApi.classStatus(classId),
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (initial.data) setStatus((prev) => prev ?? initial.data);
  }, [initial.data]);

  useEffect(() => {
    const socket = getControlSocket();
    const onStatus = (payload: TranslationStatusPayload) => {
      if (payload.classId === classId) setStatus(payload);
    };
    socket.on('translation:status', onStatus);
    return () => {
      socket.off('translation:status', onStatus);
    };
  }, [classId]);

  const toggle = useMutation({
    mutationFn: (body: { enabled: boolean; spokenLanguage?: string }) => translationApi.setClassTranslation(classId, body),
    onSuccess: (result) => {
      setError(null);
      setStatus((prev) => (prev ? { ...prev, enabled: result.enabled, spokenLang: result.spokenLanguage } : prev));
      // Turning it off drops every stream, so stop monitoring too.
      if (!result.enabled) onMonitorLangChange(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.translationClassStatus(classId) });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (languages.data && !languages.data.configured) {
    // No translator configured on this server — say so once, rather than
    // showing a toggle that can only fail.
    return null;
  }

  const enabled = status?.enabled ?? false;
  const spokenLang = status?.spokenLang ?? DEFAULT_TRANSLATION_LANGUAGE;
  const engine = status?.engine;
  const activeLangs = status?.langs ?? [];
  const speechLangs = activeLangs.filter((l) => findTranslationLanguage(l.code)?.speech);

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Languages className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">Live translation</span>

        <Button
          type="button"
          size="sm"
          variant={enabled ? 'default' : 'outline'}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ enabled: !enabled, spokenLanguage: spokenLang })}
        >
          {toggle.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {enabled ? 'On' : 'Off'}
        </Button>

        <label className="ml-2 text-xs text-muted-foreground" htmlFor="spoken-language">
          I'm speaking
        </label>
        <NativeSelect
          id="spoken-language"
          compact
          className="w-40"
          value={spokenLang}
          disabled={toggle.isPending}
          onChange={(e) => toggle.mutate({ enabled, spokenLanguage: e.target.value })}
        >
          {(languages.data?.catalog ?? []).map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      {enabled && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {activeLangs.length === 0 ? (
            <span className="text-muted-foreground">
              No student has chosen another language yet — nothing is being translated.
            </span>
          ) : (
            activeLangs.map((l) => (
              <span
                key={l.code}
                className={
                  l.state === 'error'
                    ? 'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
                    : 'inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 font-medium'
                }
                title={l.error ?? undefined}
              >
                {l.state === 'starting' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                {l.state === 'error' && <TriangleAlert className="h-3 w-3" aria-hidden />}
                {translationLanguageLabel(l.code)}
                <span className="font-normal text-muted-foreground">
                  · {l.listeners} {l.listeners === 1 ? 'listener' : 'listeners'}
                  {l.lagMs !== null && ` · ${(l.lagMs / 1000).toFixed(1)}s`}
                </span>
              </span>
            ))
          )}

          {speechLangs.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              <Headphones className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <NativeSelect
                compact
                className="w-36"
                aria-label="Monitor a translation"
                value={monitorLang ?? ''}
                onChange={(e) => onMonitorLangChange(e.target.value || null)}
              >
                <option value="">Don't monitor</option>
                {speechLangs.map((l) => (
                  <option key={l.code} value={l.code}>
                    {translationLanguageLabel(l.code)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
      )}

      {monitorLang && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Use headphones while monitoring — on speakers, the translation feeds back into your microphone.
        </p>
      )}

      {engine && !engine.reachable && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          The translation service is unreachable{engine.detail ? `: ${engine.detail}` : ''}. Students keep hearing you directly.
        </p>
      )}
      {engine?.reachable && !engine.gpu && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          Running without a GPU — translation will lag badly.{engine.detail ? ` ${engine.detail}` : ''}
        </p>
      )}
      {error && <p className="text-xs text-status-pending">{error}</p>}
    </div>
  );
}
