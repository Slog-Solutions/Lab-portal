import type { CourseTrack } from '@lab/shared';
import { PRONUNCIATION_TAGS, PRONUNCIATION_TRACK } from './pronunciation';
import { RHYTHM_TAGS, RHYTHM_TRACK } from './rhythm';
import { LISTENING_TAGS, LISTENING_TRACK } from './listening';
import { READING_TAGS, READING_TRACK } from './reading';
import { GRAMMAR_TAGS, GRAMMAR_TRACK } from './grammar';
import { WRITING_TAGS, WRITING_TRACK } from './writing';
import type { CatalogActivity, CatalogTag, CatalogTrack, CatalogUnit } from './types';

/**
 * The built-in English Course (Annexure-I Ser 10), all originally
 * authored. Order here is the order a student sees.
 */
export const CATALOG: CatalogTrack[] = [PRONUNCIATION_TRACK, RHYTHM_TRACK, LISTENING_TRACK, READING_TRACK, GRAMMAR_TRACK, WRITING_TRACK];

export const CATALOG_TAGS: Record<string, CatalogTag> = {
  ...PRONUNCIATION_TAGS,
  ...RHYTHM_TAGS,
  ...LISTENING_TAGS,
  ...READING_TAGS,
  ...GRAMMAR_TAGS,
  ...WRITING_TAGS,
};

export interface CatalogEntry {
  activity: CatalogActivity;
  track: CatalogTrack;
  unit: CatalogUnit;
}

export const CATALOG_INDEX: ReadonlyMap<string, CatalogEntry> = new Map(
  CATALOG.flatMap((track) => track.units.flatMap((unit) => unit.activities.map((a) => [a.key, { activity: a, track, unit }] as const))),
);

export function trackTitle(key: CourseTrack): string {
  return CATALOG.find((t) => t.key === key)?.title ?? key;
}

/**
 * Structural checks the type system can't express. Run by the catalog spec
 * AND at service start-up, so a content typo fails loudly instead of
 * serving an unanswerable question.
 */
export function validateCatalog(tracks: CatalogTrack[] = CATALOG, tags: Record<string, CatalogTag> = CATALOG_TAGS): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const track of tracks) {
    for (const unit of track.units) {
      for (const a of unit.activities) {
        const where = `${a.key}`;
        if (keys.has(a.key)) problems.push(`${where}: duplicate activity key`);
        keys.add(a.key);
        if (a.sampleSize !== undefined && a.sampleSize > a.items.length) problems.push(`${where}: sampleSize ${a.sampleSize} > ${a.items.length} items`);
        const itemIds = new Set<string>();
        for (const item of a.items) {
          const at = `${where}#${item.id}`;
          if (itemIds.has(item.id)) problems.push(`${at}: duplicate item id`);
          itemIds.add(item.id);
          if ('tag' in item && item.tag && !tags[item.tag]) problems.push(`${at}: unknown tag ${item.tag}`);
          switch (item.kind) {
            case 'choice':
              if (new Set(item.choices).size !== item.choices.length) problems.push(`${at}: duplicate choices`);
              if (!item.answer || !item.choices.includes(item.answer)) problems.push(`${at}: answer "${item.answer}" not among choices`);
              break;
            case 'multi':
              if (new Set(item.choices).size !== item.choices.length) problems.push(`${at}: duplicate choices`);
              if (!item.answers?.length || item.answers.some((x) => !item.choices.includes(x))) problems.push(`${at}: answers not among choices`);
              break;
            case 'gap':
              if ((item.text.match(/___/g) ?? []).length !== 1) problems.push(`${at}: gap text needs exactly one ___`);
              if (!item.answers?.length) problems.push(`${at}: no accepted answers`);
              break;
            case 'field':
              if (!item.answers?.length) problems.push(`${at}: no accepted answers`);
              break;
            case 'stress':
              if (item.answer === undefined || item.answer < 0 || item.answer >= item.units.length) problems.push(`${at}: stress answer out of range`);
              break;
            case 'write':
              if (item.minWords < 1) problems.push(`${at}: minWords must be positive`);
              if (item.mustUse && (item.mustUseMin ?? 0) > item.mustUse.length) problems.push(`${at}: mustUseMin exceeds mustUse`);
              break;
            case 'record':
              break;
          }
        }
        for (const step of a.steps ?? []) {
          for (const id of step.checkItemIds ?? []) if (!itemIds.has(id)) problems.push(`${where}: step "${step.title}" checks missing item ${id}`);
        }
        if (a.sampleSize !== undefined && a.steps?.some((s) => s.checkItemIds?.length)) {
          problems.push(`${where}: a tutorial must not sample its items (its steps reference them)`);
        }
        if (a.followUp && a.sampleSize === undefined) problems.push(`${where}: a follow-up quiz needs a sampleSize`);
        for (const part of a.writing?.parts ?? []) {
          for (const id of part.itemIds) if (!itemIds.has(id)) problems.push(`${where}: part "${part.title}" references missing item ${id}`);
        }
        for (const turn of a.dialogue ?? []) {
          if ('itemId' in turn && !itemIds.has(turn.itemId)) problems.push(`${where}: dialogue references missing item ${turn.itemId}`);
        }
      }
    }
  }
  for (const [tag, def] of Object.entries(tags)) {
    if (def.activityKey && !keys.has(def.activityKey)) problems.push(`tag ${tag}: unknown activity ${def.activityKey}`);
  }
  return problems;
}
