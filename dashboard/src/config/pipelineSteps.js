// Single source of truth for the 5 analysis steps. Display name and lead come
// from the dictionaries: t('step.' + id) and t('step.' + id + '.lead').
export const PIPELINE_STEPS = [
  { id: 'anonymize', n: 1, icon: 'shield_person', requires: [] },
  { id: 'vectors', n: 2, icon: 'manage_search', requires: ['anonymize'] },
  { id: 'rerank', n: 3, icon: 'fact_check', requires: ['vectors'], optional: true },
  { id: 'insights', n: 4, icon: 'summarize', requires: ['vectors'] },
  { id: 'query', n: 5, icon: 'question_answer', requires: ['vectors'] },
]
