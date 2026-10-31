// Single source of truth for the 5 analysis steps. Display name and lead come
// from the dictionaries: t('step.' + id) and t('step.' + id + '.lead').
// `requires` lists every step that must be done first, in order, so the first
// unmet one is the one to point at. Steps 3 to 5 also need step 1 itself: never
// work on answers whose anonymisation still needs review (D7).
export const PIPELINE_STEPS = [
  { id: 'anonymize', n: 1, icon: 'shield_person', requires: [] },
  { id: 'vectors', n: 2, icon: 'manage_search', requires: ['anonymize'] },
  { id: 'rerank', n: 3, icon: 'fact_check', requires: ['anonymize', 'vectors'], optional: true },
  { id: 'insights', n: 4, icon: 'summarize', requires: ['anonymize', 'vectors'] },
  { id: 'query', n: 5, icon: 'question_answer', requires: ['anonymize', 'vectors'] },
]
