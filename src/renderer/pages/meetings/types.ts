import type { DayKey } from '../../meeting-dates';

export type DetailTab = 'notes' | 'transcript' | 'speakers' | 'ask';

/**
 * Which slice of the archive the list is showing. 'recent' is the default
 * two-week window; 'day' is a single day picked from the calendar.
 */
export type DateView = { mode: 'recent' } | { mode: 'day'; day: DayKey };

export interface QAEntry {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}
