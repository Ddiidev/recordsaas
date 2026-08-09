import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createScreenTake,
  createTakesFromBoundaries,
  deleteTake,
  duplicateTake,
  getTakeCompositionDuration,
  getTakeScopedZoomRegions,
  mapTakeMetadataToComposition,
  mapCompositionTimeToTake,
  normalizeTakeTransitions,
  normalizeTakes,
  positionTakes,
  remapAutoZoomRegionsForTakes,
  reorderTake,
  replaceTake,
  splitTake,
  trimTake,
} from './takes.ts'

const takes = () => [createScreenTake('one', 0, 4), createScreenTake('two', 4, 4), createScreenTake('three', 8, 4)]

test('normalizes valid takes and rejects corrupt or unavailable sources', () => {
  const normalized = normalizeTakes(
    [
      { id: 'a', source: { kind: 'recording-screen' }, sourceStart: -2, duration: 99, audioMode: 'bogus', volume: 4 },
      { id: 'bad', source: { kind: 'imported-video', assetId: 'missing' }, sourceStart: 0, duration: 2 },
      null,
    ],
    { sourceDuration: 10 },
  )
  assert.equal(normalized.length, 1)
  assert.deepEqual(normalized[0].source, { kind: 'recording-screen' })
  assert.equal(normalized[0].sourceStart, 0)
  assert.equal(normalized[0].duration, 10)
  assert.equal(normalized[0].audioMode, 'session')
  assert.equal(normalized[0].volume, 1)
})

test('legacy payload without takes remains empty', () => {
  assert.deepEqual(normalizeTakes(undefined, { sourceDuration: 20 }), [])
})

test('recording boundaries ignore tiny marks and merge a tiny final take', () => {
  const result = createTakesFromBoundaries(10, [0.02, 3, 3.04, 9.95], (index) => `t${index}`, 0.1)
  assert.deepEqual(
    result.map((take) => [take.sourceStart, take.duration]),
    [
      [0, 3],
      [3, 7],
    ],
  )
})

test('split preserves source and session audio continuity', () => {
  const result = splitTake(takes(), [], 'two', 1.5, 'split')
  assert.deepEqual(
    result.takes.map((take) => take.duration),
    [4, 1.5, 2.5, 4],
  )
  assert.equal(result.takes[2].sourceStart, 5.5)
  assert.equal(result.takes[2].sessionAudioStart, 5.5)
})

test('trim clamps to source and updates session audio start', () => {
  const result = trimTake(takes(), [], 'two', 'start', 1, 12)
  assert.equal(result.takes[1].sourceStart, 5)
  assert.equal(result.takes[1].duration, 3)
  assert.equal(result.takes[1].sessionAudioStart, 5)
  const end = trimTake(result.takes, [], 'two', 'end', 99, 12)
  assert.equal(end.takes[1].duration, 7)
})

test('reorder and duplicate never retarget transitions silently', () => {
  const transition = [
    { fromTakeId: 'one', toTakeId: 'two', type: 'dissolve' as const, duration: 0.3, audioMode: 'cut' as const },
  ]
  const reordered = reorderTake(takes(), transition, 'two', 'right')
  assert.deepEqual(
    reordered.takes.map((take) => take.id),
    ['one', 'three', 'two'],
  )
  assert.deepEqual(reordered.transitions, [])
  const duplicated = duplicateTake(takes(), transition, 'one', 'copy')
  assert.deepEqual(
    duplicated.takes.map((take) => take.id),
    ['one', 'copy', 'two', 'three'],
  )
  assert.deepEqual(duplicated.transitions, [])
})

test('delete ripples and protects the final take', () => {
  const deleted = deleteTake(takes(), [], 'two')
  assert.deepEqual(
    deleted.takes.map((take) => take.id),
    ['one', 'three'],
  )
  const one = [createScreenTake('only', 0, 2)]
  assert.equal(deleteTake(one, [], 'only').takes.length, 1)
})

test('replace preserves identity and clamps duration', () => {
  const result = replaceTake(takes(), 'two', { kind: 'imported-video', assetId: 'asset' }, 1.25)
  assert.equal(result[1].id, 'two')
  assert.equal(result[1].duration, 1.25)
  assert.equal(result[1].sourceStart, 0)
  assert.equal(result[1].audioMode, 'source')
})

test('transition overlap shortens composition and maps both sources', () => {
  const pair = takes().slice(0, 2)
  const transitions = normalizeTakeTransitions(
    [{ fromTakeId: 'one', toTakeId: 'two', type: 'dissolve', duration: 1, audioMode: 'crossfade' }],
    pair,
  )
  assert.equal(getTakeCompositionDuration(pair, transitions), 7)
  const mapping = mapCompositionTimeToTake(3.5, pair, transitions)
  assert.equal(mapping?.primary.take.id, 'one')
  assert.equal(mapping?.secondary?.take.id, 'two')
  assert.equal(mapping?.primary.sourceTime, 3.5)
  assert.equal(mapping?.secondary?.sourceTime, 4.5)
  assert.equal(mapping?.transitionProgress, 0.5)
})

test('transition duration is clamped to half of the shortest adjacent take', () => {
  const pair = [createScreenTake('a', 0, 0.4), createScreenTake('b', 0.4, 2)]
  const transitions = normalizeTakeTransitions(
    [{ fromTakeId: 'a', toTakeId: 'b', type: 'zoom', duration: 2, audioMode: 'cut' }],
    pair,
  )
  assert.equal(transitions[0].duration, 0.2)
})

test('automatic zooms are clipped and re-timestamped for each remaining screen take', () => {
  const editedTakes = [createScreenTake('late', 6, 4), createScreenTake('early', 0, 3)]
  const sourceZoom = {
    id: 'auto-zoom-source-click',
    type: 'zoom' as const,
    laneId: 'lane-1',
    startTime: 5,
    duration: 3,
    zoomLevel: 1.5,
    easing: 'balanced',
    transitionDuration: 1,
    targetX: 0,
    targetY: 0,
    mode: 'auto' as const,
    zIndex: 0,
  }
  const remapped = remapAutoZoomRegionsForTakes([sourceZoom], editedTakes, [])

  assert.deepEqual(
    Object.values(remapped).map((region) => [region.generatedTakeId, region.startTime, region.duration]),
    [['late', 0, 2]],
  )
  assert.deepEqual(Object.keys(getTakeScopedZoomRegions(remapped, 'early')), [])
  assert.deepEqual(Object.keys(getTakeScopedZoomRegions(remapped, 'late')), ['auto-zoom-source-click:take:late'])
  assert.deepEqual(
    Object.values(getTakeScopedZoomRegions(remapped, 'late')).map((region) => [region.startTime, region.duration]),
    [[-1, 3]],
  )
})

test('automatic mouse events preserve prior source context and exclude future trimmed content', () => {
  const take = createScreenTake('trimmed', 4, 3)
  const positioned = positionTakes([take], [])[0]
  const metadata = [
    { timestamp: 3.9, x: 1, y: 1, type: 'move' as const },
    { timestamp: 4.5, x: 2, y: 2, type: 'click' as const, pressed: true },
    { timestamp: 6.9, x: 3, y: 3, type: 'move' as const },
    { timestamp: 7, x: 4, y: 4, type: 'click' as const, pressed: true },
  ]

  assert.deepEqual(
    mapTakeMetadataToComposition(metadata, take, positioned.start).map((event) => Number(event.timestamp.toFixed(3))),
    [-0.1, 0.5, 2.9],
  )
})
