import type {
  TranslationEngineHealth,
  TranslationLanguage,
  TranslationSettings,
  TranslationTestMode,
} from '@lab/shared';
import type { TranslationStatusPayload } from '@lab/shared/events';
import { apiFetch, apiUpload } from './api-client';
import { getRuntimeConfig } from './runtime-config';
import { useAuthStore } from '../stores/auth-store';

export interface TranslationLanguagesResponse {
  /** False when the server has no TRANSLATOR_URL — every translation
   * surface hides itself rather than offering a dead control. */
  configured: boolean;
  enabled: string[];
  catalog: TranslationLanguage[];
}

export interface TranslationTestRun {
  id: string;
  teacherId: string;
  fileName: string;
  sourceLanguage: string;
  langs: string[];
  mode: TranslationTestMode;
  status: 'queued' | 'running' | 'done' | 'failed';
  metrics: TranslationTestMetrics | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  /** Output file names (`<lang>.wav`, `<lang>.json`), present on a GET of
   * one run. */
  files?: string[];
}

export interface TranslationTestMetrics {
  /** Real-time factor: GPU seconds per second of audio, across all
   * requested languages. Below 1.0 means the engine keeps up. */
  rtf?: number;
  langs?: Record<
    string,
    {
      captionLagP50?: number;
      captionLagP95?: number;
      speechLagP50?: number;
      speechLagP95?: number;
      segments?: number;
      /** Full translated text, for reading the result without playing it. */
      transcript?: string;
    }
  >;
}

export interface CreateTestRunResponse {
  runId: string;
  /** Non-null for `realtime` mode: the LiveKit room to audition in. */
  room: string | null;
  token: string | null;
  status: string;
}

/** Thin wrappers over /api/translation/* (TranslationController). */
export const translationApi = {
  languages: () => apiFetch<TranslationLanguagesResponse>('/translation/languages'),
  health: () => apiFetch<{ configured: boolean; engine: TranslationEngineHealth }>('/translation/health'),
  getSettings: () => apiFetch<TranslationSettings>('/translation/settings'),
  putSettings: (settings: TranslationSettings) =>
    apiFetch<TranslationSettings>('/translation/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  /** The teacher's per-class toggle. */
  setClassTranslation: (classId: string, body: { enabled: boolean; spokenLanguage?: string }) =>
    apiFetch<{ enabled: boolean; spokenLanguage: string }>(`/translation/classes/${classId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  classStatus: (classId: string) => apiFetch<TranslationStatusPayload>(`/translation/classes/${classId}/status`),

  listTestRuns: (limit = 20) => apiFetch<TranslationTestRun[]>(`/translation/test-runs?limit=${limit}`),
  getTestRun: (runId: string) => apiFetch<TranslationTestRun>(`/translation/test-runs/${runId}`),
  deleteTestRun: (runId: string) => apiFetch<{ ok: true }>(`/translation/test-runs/${runId}`, { method: 'DELETE' }),

  createTestRun: (params: { file: File; langs: string[]; mode: TranslationTestMode; sourceLanguage: string }) => {
    const form = new FormData();
    form.append('file', params.file);
    // A repeated field arrives comma-separated through this stack, which
    // is what zCreateTranslationTestDto's preprocess expects.
    form.append('langs', params.langs.join(','));
    form.append('mode', params.mode);
    form.append('sourceLanguage', params.sourceLanguage);
    return apiUpload<CreateTestRunResponse>('/translation/test-runs', form);
  },

  /** <audio src> cannot carry the Authorization header, so a run's output
   * is fetched as a blob and played from an object URL — the same
   * approach as every other authenticated audio read here (see
   * AudioPreview / gradebookApi.fetchMediaAssetBlob). The caller owns
   * revoking the URL. */
  fetchFileBlob: async (runId: string, fileName: string): Promise<string> => {
    const { serverUrl } = getRuntimeConfig();
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${serverUrl}/api/translation/test-runs/${runId}/files/${encodeURIComponent(fileName)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Output fetch failed (${res.status})`);
    return URL.createObjectURL(await res.blob());
  },
};
