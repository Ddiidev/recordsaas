import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getSwapSlideStartConfig,
  normalizeSwapVisibility,
  resolveSwapRenderPlan,
  setSwapOriginVisibility,
} from './swap.ts'

test('hide Origin keeps only Target in the main frame', () => {
  assert.deepEqual(resolveSwapRenderPlan({ hideOrigin: true }), {
    kind: 'target-only',
    source: 'target',
    destination: 'main-frame',
  })
})

test('a regular swap keeps both reciprocal destinations', () => {
  assert.deepEqual(resolveSwapRenderPlan({ hideOrigin: false }), { kind: 'two-sided' })
})

test('the Origin switch maps directly to the persisted visibility state', () => {
  assert.deepEqual(normalizeSwapVisibility({}), { hideOrigin: false })
  assert.deepEqual(setSwapOriginVisibility(false), { hideOrigin: true })
  assert.deepEqual(setSwapOriginVisibility(true), { hideOrigin: false })
})

test('slide enters from the side where Target is laid out', () => {
  const mainFrame = { x: 100, y: 80, width: 800, height: 450, radius: 18 }

  assert.deepEqual(
    getSwapSlideStartConfig(
      { x: 100, y: 80, width: 520, height: 450 },
      { x: 660, y: 80, width: 240, height: 450 },
      mainFrame,
    ),
    { ...mainFrame, x: -700 },
  )
  assert.deepEqual(
    getSwapSlideStartConfig(
      { x: 660, y: 80, width: 240, height: 450 },
      { x: 100, y: 80, width: 520, height: 450 },
      mainFrame,
    ),
    { ...mainFrame, x: 900 },
  )
})
