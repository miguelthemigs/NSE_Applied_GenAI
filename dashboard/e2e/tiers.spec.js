import { test, expect, noHorizontalScroll } from './fixtures/api.js'
import { statusFixture } from './fixtures/stepper.js'

const E2B = 'unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL'
const G12B = 'unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL'
const G26B = 'unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL'
const OCTEN_06 = 'Octen/Octen-Embedding-0.6B'
const OCTEN_4B = 'Octen/Octen-Embedding-4B'

const row = (step, tier, model_id, size_bytes, cached = false) => ({ tier, step, model_id, size_bytes, cached })
const TIERS_RESPONSE = {
  tiers: [
    row('vectors', 'quick', OCTEN_06, 2.62e9),
    row('vectors', 'balanced', OCTEN_06, 6.2e9, true),
    row('vectors', 'thorough', OCTEN_4B, 16.9e9),
    row('insights', 'quick', E2B, 2.62e9),
    row('insights', 'balanced', G12B, 6.2e9, true),
    row('insights', 'thorough', G26B, 16.9e9),
  ],
  advanced: {
    vectors: [OCTEN_06, OCTEN_4B, 'Octen/Octen-Embedding-8B'],
    insights: [E2B, G12B, G26B],
  },
}

const VECTOR_ROUTES = {
  '/api/model-tiers': TIERS_RESPONSE,
  '/api/pipeline/status': statusFixture('anon-done'),
  '/api/inspect-anonymized': { status: 'success', text_columns: ['Open antwoord'], row_count: 120 },
  '/api/vector-checkpoint-status': { has_checkpoint: false },
}

const notStarted = statusFixture('all-done')
notStarted.steps.insights.state = 'not_started'
notStarted.steps.insights.summary = null

const INSIGHT_ROUTES = {
  '/api/model-tiers': TIERS_RESPONSE,
  '/api/pipeline/status': notStarted,
  '/api/cache-status': { main_baseline: 0, main_filtered: 0, subtheme_baseline: 0, subtheme_filtered: 0 },
  '/api/vector-stats': { total_documents: 120 },
  '/api/filter-options': { status: 'success', options: {} },
  'POST /api/llm-models/start-stream': { ndjson: [{ status: 'progress', stage: 'load' }, { status: 'success' }] },
  'POST /api/precompute-insights': { ndjson: [{ status: 'success', progress: 100 }] },
}

const radio = (scope, name) => scope.getByRole('radio', { name })

test.describe('model tiers, step 2', () => {
  test('Balanced is checked by default with the badge; technical ids wait behind Advanced', async ({ page, mockApi }) => {
    await mockApi(VECTOR_ROUTES)
    await page.goto('/pipeline-demo?step=vectors')
    const p = page.locator('#step-panel-vectors')
    const group = p.getByRole('radiogroup', { name: 'Hoe grondig?' })
    await expect(radio(group, /Gebalanceerd/)).toBeChecked()
    await expect(radio(group, /Snel/)).not.toBeChecked()
    await expect(group.getByText('Aanbevolen', { exact: true })).toBeVisible()
    await expect(group.getByText('2,6 GB')).toBeVisible()
    await expect(group.getByText('6,2 GB')).toBeVisible()
    await expect(group.getByText('16,9 GB')).toBeVisible()
    await expect(group.getByText('Al op deze computer')).toBeVisible()
    await expect(group.getByText('Eenmalige download')).toHaveCount(2)

    await expect(p.getByText(OCTEN_4B)).toBeHidden()
    await p.getByText('Geavanceerd').first().click()
    await expect(p.getByRole('option', { name: OCTEN_4B })).toBeAttached()
    await expect(p.locator('details', { hasText: 'Geavanceerd' }).first().locator('select')).toBeVisible()
  })

  test('desktop shows the cards side by side, mobile stacks them', async ({ page, mockApi }, testInfo) => {
    await mockApi(VECTOR_ROUTES)
    await page.goto('/pipeline-demo?step=vectors')
    const group = page.locator('#step-panel-vectors').getByRole('radiogroup')
    await expect(radio(group, /Snel/)).toBeVisible()
    const boxes = await group.locator('label').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
    expect(boxes).toHaveLength(3)
    if (testInfo.project.name === 'mobile') {
      expect(boxes[1].top).toBeGreaterThan(boxes[0].bottom - 1)
      expect(boxes[2].top).toBeGreaterThan(boxes[1].bottom - 1)
      expect(Math.abs(boxes[0].width - boxes[2].width)).toBeLessThan(2)
      await noHorizontalScroll(page)
    } else {
      expect(Math.abs(boxes[0].top - boxes[1].top)).toBeLessThan(2)
      expect(Math.abs(boxes[1].top - boxes[2].top)).toBeLessThan(2)
      expect(boxes[1].left).toBeGreaterThan(boxes[0].right - 1)
      expect(boxes[2].left).toBeGreaterThan(boxes[1].right - 1)
    }
  })

  test('arrow keys move the selection and the build sends that tier model', async ({ page, mockApi }) => {
    await mockApi({ ...VECTOR_ROUTES, 'POST /api/build-vectors': { ndjson: [{ status: 'success', progress: 100 }] } })
    await page.goto('/pipeline-demo?step=vectors')
    const p = page.locator('#step-panel-vectors')
    const group = p.getByRole('radiogroup')
    await radio(group, /Gebalanceerd/).focus()
    await page.keyboard.press('ArrowRight')
    await expect(radio(group, /Meest grondig/)).toBeChecked()
    await expect(radio(group, /Gebalanceerd/)).not.toBeChecked()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(radio(group, /Snel/)).toBeChecked()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(radio(group, /Meest grondig/)).toBeChecked()

    await p.getByRole('button', { name: 'Antwoorden doorzoekbaar maken', exact: true }).click()
    await expect.poll(() => mockApi.requestsTo('/api/build-vectors', 'POST').length).toBe(1)
    expect(mockApi.requestsTo('/api/build-vectors', 'POST')[0].body.embedding_model).toBe(OCTEN_4B)
  })

  test('an Advanced model id wins and no tier shows as selected', async ({ page, mockApi }) => {
    await mockApi({ ...VECTOR_ROUTES, 'POST /api/build-vectors': { ndjson: [{ status: 'success', progress: 100 }] } })
    await page.goto('/pipeline-demo?step=vectors')
    const p = page.locator('#step-panel-vectors')
    await p.getByText('Geavanceerd').first().click()
    await p.locator('select').selectOption('Octen/Octen-Embedding-8B')
    for (const r of await p.getByRole('radio').all()) await expect(r).not.toBeChecked()
    await p.getByRole('button', { name: 'Antwoorden doorzoekbaar maken', exact: true }).click()
    await expect.poll(() => mockApi.requestsTo('/api/build-vectors', 'POST').length).toBe(1)
    expect(mockApi.requestsTo('/api/build-vectors', 'POST')[0].body.embedding_model).toBe('Octen/Octen-Embedding-8B')
  })

  test('an existing build tier is pre-selected', async ({ page, mockApi }) => {
    const s = statusFixture('anon-done')
    s.steps.vectors.summary = { documents: 120, tier: 'thorough', model: OCTEN_4B }
    await mockApi({ ...VECTOR_ROUTES, '/api/pipeline/status': s })
    await page.goto('/pipeline-demo?step=vectors')
    await expect(radio(page.locator('#step-panel-vectors'), /Meest grondig/)).toBeChecked()
  })

  test('a failed tier lookup still shows three usable cards without sizes', async ({ page, mockApi }) => {
    await mockApi({ ...VECTOR_ROUTES, '/api/model-tiers': { status: 500, json: { error: 'x' } } })
    await page.goto('/pipeline-demo?step=vectors')
    const p = page.locator('#step-panel-vectors')
    await expect(p.getByRole('radio')).toHaveCount(3)
    await expect(radio(p, /Gebalanceerd/)).toBeChecked()
    await expect(p.getByText(/GB/)).toHaveCount(0)
    await expect(p.getByRole('radiogroup').getByText('Al op deze computer')).toHaveCount(0)
  })
})

test.describe('model tiers, step 4', () => {
  test('Balanced by default; choosing Snel does not start a model, the run starts the quick one', async ({ page, mockApi }) => {
    await mockApi(INSIGHT_ROUTES)
    await page.goto('/pipeline-demo?step=insights')
    const p = page.locator('#step-panel-insights')
    await expect(radio(p, /Gebalanceerd/)).toBeChecked()
    await expect(p.getByText('Aanbevolen', { exact: true })).toBeVisible()
    await expect(p.getByText(G12B)).toBeHidden()

    await radio(p, /Snel/).check()
    await expect(radio(p, /Snel/)).toBeChecked()
    await radio(p, /Meest grondig/).check()
    await radio(p, /Snel/).check()
    // Choosing a tier starts nothing (no 2.5-minute model start on a radio click).
    expect(mockApi.requests.filter((r) => r.path.startsWith('/api/llm-models/start'))).toHaveLength(0)

    await p.getByRole('button', { name: /Thema's samenvatten/ }).click()
    await expect.poll(() => mockApi.requestsTo('/api/precompute-insights', 'POST').length).toBe(1)
    expect(mockApi.requestsTo('/api/llm-models/start-stream', 'POST').map((r) => r.body.model_id)).toEqual([E2B])
    expect(mockApi.requestsTo('/api/precompute-insights', 'POST')[0].body.llm_model).toBe(E2B)
  })
})
