import type { TestRevealDetail, TestRevealMode, VocabTestSettings } from '../../lib/assessments-api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

export interface TestSettingsDraft {
  /** Minutes, as typed text — blank means untimed. Converted to
   * `timeLimitSec` only at save time (settingsDraftToApi). */
  timeLimitMinutes: string;
  revealMode: TestRevealMode;
  revealDetail: TestRevealDetail;
  allowReview: boolean;
  sampleSize: string;
}

export const DEFAULT_SETTINGS_DRAFT: TestSettingsDraft = {
  timeLimitMinutes: '',
  revealMode: 'ON_TIME_EXPIRY',
  revealDetail: 'FULL_ANSWERS',
  allowReview: true,
  sampleSize: '',
};

export function settingsToDraft(s: VocabTestSettings | undefined): TestSettingsDraft {
  if (!s) return DEFAULT_SETTINGS_DRAFT;
  return {
    timeLimitMinutes: s.timeLimitSec ? String(Math.round(s.timeLimitSec / 60)) : '',
    revealMode: s.revealMode,
    revealDetail: s.revealDetail,
    allowReview: s.allowReview,
    sampleSize: s.sampleSize ? String(s.sampleSize) : '',
  };
}

function positiveInt(text: string): number | undefined {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function settingsDraftToApi(d: TestSettingsDraft): {
  timeLimitSec?: number;
  revealMode: TestRevealMode;
  revealDetail: TestRevealDetail;
  allowReview: boolean;
  sampleSize?: number;
} {
  const minutes = positiveInt(d.timeLimitMinutes);
  return {
    timeLimitSec: minutes ? minutes * 60 : undefined,
    revealMode: d.revealMode,
    revealDetail: d.revealDetail,
    allowReview: d.allowReview,
    sampleSize: positiveInt(d.sampleSize),
  };
}

/** True when the draft can be saved — mirrors zVocabularyTestConfig's own
 * refine (ON_TIME_EXPIRY needs a time limit); this is feedback, the server
 * is still the real gate. */
export function settingsDraftValid(d: TestSettingsDraft): boolean {
  return d.revealMode !== 'ON_TIME_EXPIRY' || positiveInt(d.timeLimitMinutes) !== undefined;
}

const REVEAL_MODE_HELP: Record<TestRevealMode, string> = {
  ON_TIME_EXPIRY: 'Students see the correct answers when the time runs out — everyone at once.',
  ON_SUBMIT: 'Each student sees their own answers the moment they submit. Best for practice, not a real test.',
  ON_TEACHER_RELEASE: 'Nothing shows until you release the results, however long students take.',
};

/** SPEC-mcq-test-timed-reveal.md §7.2. */
export function TestSettingsPanel({
  value,
  onChange,
  questionCount,
}: {
  value: TestSettingsDraft;
  onChange: (next: TestSettingsDraft) => void;
  questionCount: number;
}) {
  const set = <K extends keyof TestSettingsDraft>(key: K, v: TestSettingsDraft[K]): void => onChange({ ...value, [key]: v });
  const needsTimeLimit = value.revealMode === 'ON_TIME_EXPIRY';
  const missingTimeLimit = needsTimeLimit && positiveInt(value.timeLimitMinutes) === undefined;

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">Test settings</h3>

      <div className="space-y-1.5">
        <Label htmlFor="ts-time">
          Time limit (minutes){needsTimeLimit && <span className="text-destructive"> *</span>}
        </Label>
        <Input
          id="ts-time"
          type="number"
          min={1}
          max={180}
          value={value.timeLimitMinutes}
          onChange={(e) => set('timeLimitMinutes', e.target.value)}
          placeholder="No limit"
          className="w-32"
        />
        {missingTimeLimit && <p className="text-xs text-destructive">A time limit is required to reveal answers when time runs out.</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ts-reveal-mode">When students see the correct answers</Label>
        <NativeSelect
          id="ts-reveal-mode"
          value={value.revealMode}
          onChange={(e) => set('revealMode', e.target.value as TestRevealMode)}
          className="w-full"
        >
          <option value="ON_TIME_EXPIRY">When the time runs out</option>
          <option value="ON_SUBMIT">As soon as they submit</option>
          <option value="ON_TEACHER_RELEASE">Only when I release them</option>
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{REVEAL_MODE_HELP[value.revealMode]}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ts-reveal-detail">What students see once revealed</Label>
        <NativeSelect
          id="ts-reveal-detail"
          value={value.revealDetail}
          onChange={(e) => set('revealDetail', e.target.value as TestRevealDetail)}
          className="w-full"
        >
          <option value="FULL_ANSWERS">Their answer, the correct answer, and the explanation</option>
          <option value="SCORE_AND_FLAGS">Just right/wrong per question</option>
          <option value="SCORE_ONLY">Only their overall score</option>
        </NativeSelect>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.allowReview} onChange={(e) => set('allowReview', e.target.checked)} />
        Let students review their answers before submitting
      </label>

      <div className="space-y-1.5">
        <Label htmlFor="ts-sample">Questions per student (optional)</Label>
        <Input
          id="ts-sample"
          type="number"
          min={1}
          max={questionCount || undefined}
          value={value.sampleSize}
          onChange={(e) => set('sampleSize', e.target.value)}
          placeholder="All"
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">Fewer than the list gives each student a different random selection.</p>
      </div>
    </div>
  );
}
