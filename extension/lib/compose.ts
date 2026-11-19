/** Sentence starters shown in the review overlay. Answers are stitched into the review text. */
export const PROMPTS: { id: string; starter: string; placeholder: string }[] = [
  { id: 'overall', starter: 'Overall,', placeholder: 'the class was well organized and fair' },
  { id: 'exams', starter: 'The exams were', placeholder: 'mostly based on the homework' },
  { id: 'tip', starter: 'To do well,', placeholder: 'go to office hours before each exam' },
  { id: 'who', starter: 'I would recommend this professor to', placeholder: 'anyone who keeps up with the reading' },
];

export const MAX_COMMENT = 350;

function sentence(starter: string, answer: string): string {
  const a = answer.trim().replace(/[.!?]+$/, '');
  if (!a) return '';
  return `${starter} ${a}.`;
}

/** Build review text from prompt answers. Empty answers are dropped. */
export function composeReview(answers: Record<string, string>): string {
  return PROMPTS.map((p) => sentence(p.starter, answers[p.id] ?? ''))
    .filter(Boolean)
    .join(' ');
}
