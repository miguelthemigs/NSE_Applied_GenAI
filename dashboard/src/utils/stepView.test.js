import { deriveStepView, firstOpenStep } from './stepView'
import fresh from '../../e2e/fixtures/status/fresh.json'
import allDone from '../../e2e/fixtures/status/all-done.json'
import anonUnverified from '../../e2e/fixtures/status/anon-unverified.json'
import anonNeedsReview from '../../e2e/fixtures/status/anon-needs-review.json'
import vectorsRunning from '../../e2e/fixtures/status/vectors-running.json'
import anonDone from '../../e2e/fixtures/status/anon-done.json'

// Build a status from all-done with some step states overridden.
function withStates(states, activeJob = null) {
  const steps = structuredClone(allDone.steps)
  for (const [id, state] of Object.entries(states)) steps[id] = { ...steps[id], state }
  return { ...allDone, active_job: activeJob, steps }
}

describe('deriveStepView', () => {
  it('fresh install: insights is blocked by the first unmet step, step 1', () => {
    expect(deriveStepView(fresh, 'insights')).toEqual({ state: 'blocked', blockedBy: 'anonymize', canStart: false })
  })

  it('step 1 done, no vectors: insights is blocked by vectors', () => {
    expect(deriveStepView(anonDone, 'insights')).toEqual({ state: 'blocked', blockedBy: 'vectors', canStart: false })
  })

  it('fresh install: step 1 can start, step 2 is blocked by step 1', () => {
    expect(deriveStepView(fresh, 'anonymize')).toEqual({ state: 'not_started', blockedBy: null, canStart: true })
    expect(deriveStepView(fresh, 'vectors')).toMatchObject({ state: 'blocked', blockedBy: 'anonymize', canStart: false })
  })

  it('insights can start when vectors are done and rerank is not_started', () => {
    const status = withStates({ rerank: 'not_started', insights: 'not_started' })
    expect(deriveStepView(status, 'insights')).toEqual({ state: 'not_started', blockedBy: null, canStart: true })
  })

  it('nothing can start while a job is active', () => {
    const status = withStates({}, { step: 'rerank', stage: null, progress: null })
    for (const id of ['anonymize', 'vectors', 'rerank', 'insights', 'query']) {
      expect(deriveStepView(status, id).canStart, id).toBe(false)
    }
  })

  it('the active job step reads in_progress, even before its first event', () => {
    const status = withStates({}, { step: 'insights', stage: null, progress: null })
    expect(deriveStepView(status, 'insights').state).toBe('in_progress')
    expect(deriveStepView(vectorsRunning, 'vectors')).toMatchObject({ state: 'in_progress', canStart: false })
  })

  it('stale and skipped requirements still count as done', () => {
    expect(deriveStepView(withStates({ vectors: 'stale' }), 'insights')).toMatchObject({ blockedBy: null, canStart: true })
    expect(deriveStepView(withStates({ anonymize: 'skipped' }), 'vectors')).toMatchObject({ blockedBy: null, canStart: true })
  })

  it('privacy gate: step 2 stays blocked while step 1 is unverified or needs review', () => {
    expect(deriveStepView(anonUnverified, 'vectors')).toMatchObject({ state: 'blocked', blockedBy: 'anonymize', canStart: false })
    expect(deriveStepView(anonNeedsReview, 'vectors')).toMatchObject({ blockedBy: 'anonymize', canStart: false })
  })

  it('gates on the required step, not the target step: a done vector DB is still gated by an unverified step 1', () => {
    const status = withStates({ anonymize: 'unverified' })
    expect(deriveStepView(status, 'vectors')).toEqual({ state: 'done', blockedBy: 'anonymize', canStart: false })
  })

  it('privacy gate: steps 3, 4 and 5 are blocked by step 1 while it needs review, even with vectors done', () => {
    // The real install: step 1 needs review, the existing vector DB is done.
    const status = withStates({ anonymize: 'needs_review', rerank: 'not_started', insights: 'not_started' })
    for (const id of ['rerank', 'insights', 'query']) {
      expect(deriveStepView(status, id), id).toMatchObject({ blockedBy: 'anonymize', canStart: false })
    }
    expect(deriveStepView(status, 'insights').state).toBe('blocked')
  })

  it('a ready step 5 reads blocked while step 1 needs review: it cannot be used', () => {
    const status = withStates({ anonymize: 'needs_review' })
    expect(deriveStepView(status, 'query')).toEqual({ state: 'blocked', blockedBy: 'anonymize', canStart: false })
  })

  it.each(['unverified', 'not_started', 'in_progress', 'interrupted', 'error'])(
    'a %s step 1 blocks steps 3 to 5 and is named first, before vectors',
    (state) => {
      const status = withStates({ anonymize: state, vectors: 'not_started' })
      for (const id of ['rerank', 'insights', 'query']) {
        expect(deriveStepView(status, id).blockedBy, id).toBe('anonymize')
      }
    },
  )

  it.each(['needs_review', 'unverified', 'error', 'interrupted', 'partial', 'in_progress', 'not_started'])(
    'a %s requirement does not count as done',
    (state) => {
      expect(deriveStepView(withStates({ vectors: state }), 'insights')).toMatchObject({ blockedBy: 'vectors', canStart: false })
    },
  )

  it('without a status every step is unknown and nothing can start', () => {
    for (const id of ['anonymize', 'vectors', 'rerank', 'insights', 'query']) {
      expect(deriveStepView(null, id), id).toEqual({ state: 'unknown', blockedBy: null, canStart: false })
    }
  })
})

describe('firstOpenStep', () => {
  it('returns rerank when steps 1 and 2 are done', () => {
    expect(firstOpenStep(withStates({ rerank: 'not_started', insights: 'not_started' }))).toBe('rerank')
  })

  it('returns anonymize on a fresh install and while step 1 needs review', () => {
    expect(firstOpenStep(fresh)).toBe('anonymize')
    expect(firstOpenStep(anonNeedsReview)).toBe('anonymize')
  })

  it('skips a skipped rerank', () => {
    expect(firstOpenStep(withStates({ rerank: 'skipped', insights: 'partial' }))).toBe('insights')
  })

  it('returns the running step', () => {
    expect(firstOpenStep(vectorsRunning)).toBe('vectors')
  })

  it('returns the last step when everything is done, and step 1 without a status', () => {
    expect(firstOpenStep(allDone)).toBe('query')
    expect(firstOpenStep(null)).toBe('anonymize')
  })
})
