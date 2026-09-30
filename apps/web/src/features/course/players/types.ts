import type { CourseActivityView } from '@lab/shared';
import type { StationControlClient } from '../../../lib/station-control-client';
import type { CourseSpeechApi } from '../use-course-speech';

/** What every kind-specific player gets from CourseActivityPlayer. The
 * player owns its own flow; answers live one level up so a submit (or a
 * resume after a section switch) sees them all. */
export interface PlayerProps {
  activity: CourseActivityView;
  attemptId: string;
  answers: Record<string, string>;
  setAnswer: (itemId: string, value: string) => void;
  speech: CourseSpeechApi;
  control: StationControlClient;
  submitting: boolean;
  onSubmit: (extra?: { readingMs?: number }) => void;
}
