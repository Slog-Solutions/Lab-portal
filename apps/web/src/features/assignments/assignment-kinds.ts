import { BookOpenText, Headphones, Languages, PenLine, type LucideIcon } from 'lucide-react';
import type { AssessmentType } from '../../lib/assessments-api';

export type AssignmentKindSlug = 'vocabulary' | 'writing' | 'listening' | 'reading';

export interface AssignmentKind {
  /** URL segment: /assignments/<slug> */
  slug: AssignmentKindSlug;
  type: AssessmentType;
  label: string;
  icon: LucideIcon;
  description: string;
}

/** The types offered under "Create Assignment" in the sidebar, in the order
 * they appear there. */
export const ASSIGNMENT_KINDS: AssignmentKind[] = [
  {
    slug: 'vocabulary',
    type: 'VOCABULARY_TEST',
    label: 'Vocabulary Test',
    icon: Languages,
    description: 'A list of words or short questions. Students answer on their own console and it is marked automatically.',
  },
  {
    slug: 'writing',
    type: 'WRITING_TEST',
    label: 'Writing Test',
    icon: PenLine,
    description: 'Give a prompt. Each student writes their answer on their console; you read it and give a mark and feedback.',
  },
  {
    slug: 'listening',
    type: 'LISTENING_TEST',
    label: 'Listening Test',
    icon: Headphones,
    description: 'Play an audio clip and ask questions about it. Students answer on their own console and it is marked automatically.',
  },
  {
    slug: 'reading',
    type: 'READING_TEST',
    label: 'Reading Test',
    icon: BookOpenText,
    description: 'Give a sentence or paragraph. Each student reads it aloud on their console; you listen and give a mark.',
  },
];

export function kindBySlug(slug: string | undefined): AssignmentKind | undefined {
  return ASSIGNMENT_KINDS.find((k) => k.slug === slug);
}

/** Undefined for a type with no "Create Assignment" card — the server's
 * ASSESSMENT_TYPES and this list are maintained separately, so callers must
 * have a fallback rather than trust a lookup that can never miss. */
export function kindByType(type: string): AssignmentKind | undefined {
  return ASSIGNMENT_KINDS.find((k) => k.type === type);
}
