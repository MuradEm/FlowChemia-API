// A design target, not an expiry or a timer that interrupts an employee.
export const SURVEY_FORMAT = {
  questionCount: 5,
  targetDurationSeconds: 120,
  answerType: 'RATING',
  writtenAnswers: false,
  defaultComposition: {skillQuestions: 3, chemistryQuestions: 2},
  alternativeComposition: {skillQuestions: 4, chemistryQuestions: 1},
} as const;
