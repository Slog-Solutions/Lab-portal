import { apiFetch } from './api-client';

export const pronunciationApi = {
  status: () => apiFetch<{ ipa: boolean; voice: boolean }>('/pronunciation/status'),
  generate: (sourceText: string, voice: 'en_US' | 'en_GB') =>
    apiFetch<{ ipaAssetId: string | null; modelAudioAssetId: string | null; warnings: string[] }>('/pronunciation/generate', {
      method: 'POST',
      body: JSON.stringify({ sourceText, voice }),
    }),
};
