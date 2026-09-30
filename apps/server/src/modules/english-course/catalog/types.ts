import type { CourseActivityView, CourseTrack } from '@lab/shared';

/**
 * One activity as authored. Same shape as the view a seat receives, minus
 * what the server fills in (exerciseId, track, unitKey), plus serving rules.
 * Every gradable item carries its answer here; EnglishCourseService strips
 * it from a test-mode activity's view.
 */
export interface CatalogActivity extends Omit<CourseActivityView, 'exerciseId' | 'track' | 'unitKey'> {
  /** Serve a random subset of this many items per attempt ("Large Test
   * Bank": a different set of questions each time). */
  sampleSize?: number;
  /** Shuffle the served order (implied by sampleSize). */
  shuffle?: boolean;
  /** Serve the items of the areas THIS student last got wrong (needs
   * sampleSize) — the grammar "follow up quiz". */
  followUp?: boolean;
}

export interface CatalogUnit {
  key: string;
  title: string;
  description?: string;
  activities: CatalogActivity[];
}

export interface CatalogTrack {
  key: CourseTrack;
  title: string;
  description: string;
  units: CatalogUnit[];
}

/** What an item `tag` means, for the post-test "areas to review" list
 * (Ser 10 "Follow up quiz ... highlights the particular areas where the
 * learner made mistakes"). */
export interface CatalogTag {
  label: string;
  /** The activity that teaches/re-tests this area. */
  activityKey?: string;
}
