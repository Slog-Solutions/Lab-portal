import { ROUND_TABLE_DEFAULTS, roundTableConfigFromForm, type RoundTableForm } from '../round-table/RoundTableAuthoring';

/** Composable here without leaving the builder — every registered
 * ActivityType now has either a player or (self-study) its own dedicated
 * browsing surface; see packages/shared/src/activities for the full
 * registry and StudyLibraryPanel for why SELF_STUDY isn't listed here
 * (it's reached directly from the student console, not scheduled into a
 * session slot). */
export type BuilderActivityType = 'VOCABULARY_TEST' | 'ROUND_TABLE' | 'TELEPHONE' | 'MODEL_IMITATION' | 'CONFERENCE_INTERPRETING';

// SPEC-mcq-test-timed-reveal.md — VOCABULARY_TEST is deliberately absent
// here: the public POST /sessions now refuses that type outright
// (SessionsService.create), because the generic builder below only ever
// produced an unlinked, answer-bearing inline config (buildActivityConfig's
// own VOCABULARY_TEST case, kept only so GroupDraft/buildActivityConfig's
// switch stays exhaustive for any lingering caller — never reachable from
// this picker). A vocabulary test now launches only through a saved test's
// own "Launch in lab" button (TimedTestsService.launch), which links the
// live instance back to the real, answer-key-stripped Exercise.
export const ACTIVITY_OPTIONS: Array<{ type: BuilderActivityType; label: string }> = [
  { type: 'ROUND_TABLE', label: 'Round Table Discussion' },
  { type: 'TELEPHONE', label: 'Telephone Activity' },
  { type: 'MODEL_IMITATION', label: 'Model Imitation' },
  { type: 'CONFERENCE_INTERPRETING', label: 'Conference Interpreting' },
];

export type InterpretingRoleChoice = 'INTERPRETER' | 'DELEGATE' | 'OBSERVER';

// RoundTableForm supplies topic (ROUND_TABLE topic / TELEPHONE scenario /
// CONFERENCE_INTERPRETING topic), memberStationIds, and the Ser 3 settings
// (chairmanStationId '' = none picked yet).
export interface GroupDraft extends RoundTableForm {
  index: number;
  activityType: BuilderActivityType;
  wordPairs: string; // VOCABULARY_TEST raw textarea: "word=answer" per line
  masterTrackAssetId: string; // MODEL_IMITATION only
  languages: string; // CONFERENCE_INTERPRETING only — comma-separated
  // CONFERENCE_INTERPRETING only — per-member role + language, keyed by stationId.
  interpretingRoles: Record<string, { role: InterpretingRoleChoice; lang: string }>;
  // Offline dictionary (SPEC-offline-dictionary.md §7). `dictionaryEnabled`
  // tracks the checkbox's current value; `dictionaryEnabledTouched` is
  // false until the teacher actually clicks it, so switching the activity
  // type keeps following that type's own default (VOCABULARY_TEST off,
  // everything else on) right up until the teacher makes an explicit
  // choice — see defaultDictionaryEnabled and its call sites.
  dictionaryEnabled: boolean;
  dictionaryEnabledTouched: boolean;
}

/** Mirrors @lab/shared's resolveDictionaryEnabled default (VOCABULARY_TEST
 * off, everything else on) for the still-untouched checkbox. */
export function defaultDictionaryEnabled(activityType: BuilderActivityType): boolean {
  return activityType !== 'VOCABULARY_TEST';
}

export function emptyGroup(index: number, activityType: BuilderActivityType = 'ROUND_TABLE'): GroupDraft {
  return {
    index,
    activityType,
    topic: '',
    wordPairs: '',
    memberStationIds: [],
    chairmanStationId: '',
    ...ROUND_TABLE_DEFAULTS,
    masterTrackAssetId: '',
    languages: '',
    interpretingRoles: {},
    dictionaryEnabled: defaultDictionaryEnabled(activityType),
    dictionaryEnabledTouched: false,
  };
}

export function buildActivityConfig(group: GroupDraft): unknown {
  switch (group.activityType) {
    case 'VOCABULARY_TEST':
      return {
        shuffleItems: true,
        items: group.wordPairs
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [prompt, answer] = line.split('=').map((s) => s.trim());
            return { prompt: prompt ?? line, answer: answer ?? '' };
          }),
      };
    case 'ROUND_TABLE':
      return roundTableConfigFromForm(group);
    case 'TELEPHONE':
      return { scenario: group.topic || undefined, maxDurationSec: 600 };
    case 'MODEL_IMITATION':
      return { masterTrackAssetId: group.masterTrackAssetId, pausePoints: [], allowManualPause: true };
    case 'CONFERENCE_INTERPRETING':
      return {
        topic: group.topic || 'Untitled conference',
        languages: group.languages
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean),
        roles: group.memberStationIds
          .filter((id) => group.interpretingRoles[id])
          .map((id) => ({ stationId: id, role: group.interpretingRoles[id]!.role, lang: group.interpretingRoles[id]!.lang || undefined })),
      };
  }
}

/** Someone (or some seat) the composer can put into a group. The engine
 * delivers to seats, so a pick is always a stationId underneath. */
export interface MemberCandidate {
  key: string;
  /** Null when the candidate can't be picked right now (a student who isn't signed in at a PC). */
  stationId: string | null;
  label: string;
  detail?: string;
  /** Picking students (a class's own screen): who this pick is for. */
  studentId?: string;
  /** Shown instead of `detail` when the candidate can't be picked. */
  disabledReason?: string;
}

/** A class-mode pick, remembered as it was made, so a student who moves or
 * signs out before Create is caught (the server re-checks every pick). */
export interface StudentPick {
  studentId: string;
  label: string;
}

/** The sessions list rows (GET /sessions). */
export interface SessionSummary {
  id: string;
  title: string;
  state: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  groups: Array<{
    id: string;
    index: number;
    activity?: { id: string; type: string; dictionaryEnabled: boolean | null; exerciseId?: string | null } | null;
    members?: Array<{ student: { id: string; fullName: string } | null }>;
  }>;
}
