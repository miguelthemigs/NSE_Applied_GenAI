export const REAL_THEME_META = {
  'Content and Organisation': {
    slug: 'content_organisation',
    id: 'content_org',
    icon: 'menu_book',
    subtag: 'Curriculum and planning',
    description: 'Whether the curriculum feels coherent, relevant, manageable, and well organized.',
  },
  'Professional Practice': {
    slug: 'professional_practice',
    id: 'link_practice',
    icon: 'work',
    subtag: 'Career readiness',
    description: 'How well the programme prepares students for real professional work.',
  },
  Teachers: {
    slug: 'teachers',
    id: 'teachers',
    icon: 'school',
    subtag: 'Teaching quality',
    description: 'How students experience teachers, their explanations, and classroom support.',
  },
  'Support / Mentoring': {
    slug: 'support_mentoring',
    id: 'support',
    icon: 'support_agent',
    subtag: 'Guidance and care',
    description: 'Whether students can find useful guidance when they need support.',
  },
  'Examination & Assessment': {
    slug: 'examination_assessment',
    id: 'examination',
    icon: 'gavel',
    subtag: 'Assessment quality',
    description: 'Whether assessment, grading, and feedback feel clear, fair, and useful.',
  },
  'Engagement & Contact': {
    slug: 'engagement_contact',
    id: 'engagement',
    icon: 'groups',
    subtag: 'Community and belonging',
    description: 'Whether students feel connected, motivated, heard, and able to reach teachers.',
  },
  'Special Circumstances': {
    slug: 'special_circumstances',
    id: 'special_circumstances',
    icon: 'accessible',
    subtag: 'Accessibility and accommodations',
    description: 'How well the programme supports students whose circumstances affect studying.',
  },
}

/**
 * Display name of a theme. Theme names are English data/cache keys and must
 * not be shown as-is: this maps a key to its translated label (t('theme.<slug>')).
 * Unknown names (e.g. a new theme from the backend) fall back to the raw name.
 */
export function themeLabel(t, themeName) {
  const slug = REAL_THEME_META[themeName]?.slug
  return slug ? t('theme.' + slug) : themeName
}

/** Translated one-line tag / description of a theme; falls back to the English source text. */
export function themeText(t, themeName, part, fallback) {
  const slug = REAL_THEME_META[themeName]?.slug
  return slug ? t(`theme.${slug}.${part}`) : fallback
}

export const THEME_NAME_BY_ID = Object.fromEntries(
  Object.entries(REAL_THEME_META).map(([name, meta]) => [meta.id, name]),
)

function fallbackId(themeName) {
  return String(themeName || 'theme')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function buildRealTheme(themeName, insight = {}, { includeInsightDetails = true } = {}) {
  const meta = REAL_THEME_META[themeName] ?? {
    id: fallbackId(themeName),
    icon: 'analytics',
    subtag: null,
  }
  const frequency = typeof insight.frequency === 'number' ? insight.frequency : 0
  const responseCount =
    typeof insight.vector_relevant_count === 'number'
      ? insight.vector_relevant_count
      : typeof insight.document_count === 'number'
        ? insight.document_count
        : 0

  return {
    id: meta.id,
    name: themeName,
    icon: meta.icon,
    size: 'small',
    subtag: meta.subtag,
    description: meta.description ?? '',
    percentage: frequency,
    responseCount,
    aiSummary: includeInsightDetails ? insight.summary || '' : '',
    subthemes: includeInsightDetails && Array.isArray(insight.subthemes) ? insight.subthemes : [],
    subtheme_mentions:
      includeInsightDetails && Array.isArray(insight.subtheme_mentions)
        ? insight.subtheme_mentions
        : [],
    quotes: includeInsightDetails && Array.isArray(insight.quotes) ? insight.quotes : [],
    student_suggestions:
      includeInsightDetails && Array.isArray(insight.student_suggestions)
        ? insight.student_suggestions
        : [],
    cachedInsight: includeInsightDetails ? { ...insight, status: 'success' } : null,
    trend: [frequency, frequency, frequency, frequency],
    _live: true,
  }
}
