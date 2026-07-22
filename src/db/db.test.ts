import { describe, expect, it, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db, exportAll, importAll, seedIfEmpty } from './db'

beforeEach(async () => {
  await Promise.all([
    db.days.clear(),
    db.metrics.clear(),
    db.workouts.clear(),
    db.prs.clear(),
    db.tracks.clear(),
    db.neverAgain.clear(),
    db.rewardsLog.clear(),
    db.reviews.clear(),
    db.settings.clear(),
  ])
})

describe('seed + JSON round-trip', () => {
  it('seeds the grounding data exactly and only once', async () => {
    await seedIfEmpty()
    const settings = await db.settings.get('singleton')
    expect(settings?.targets.masterNumber).toBe(6000)
    expect(settings?.targets.weightTargetLow).toBe(155)
    expect(settings?.restDay).toBe(0) // Sunday default

    const tracks = await db.tracks.toArray()
    expect(tracks).toHaveLength(6)
    // endowed starter-progress — never begins at zero
    expect(tracks.every((t) => t.xp > 0)).toBe(true)

    const na = await db.neverAgain.toArray()
    expect(na.map((n) => n.key).sort()).toEqual(
      ['gambling', 'gaming', 'past10', 'phoneInBed', 'porn', 'vape'].sort(),
    )

    // seeding again does not duplicate
    await seedIfEmpty()
    expect(await db.tracks.count()).toBe(6)
  })

  it('exports, wipes, and re-imports without data loss', async () => {
    await seedIfEmpty()
    await db.metrics.add({ date: '2026-07-22', type: 'weight', value: 170, unit: 'lb' })
    const before = await exportAll()

    // wipe everything
    await importAll({ ...before, data: { days: [], metrics: [], workouts: [], prs: [], tracks: [], neverAgain: [], rewardsLog: [], reviews: [], settings: [] } })
    expect(await db.metrics.count()).toBe(0)

    // restore from the earlier export
    await importAll(before)
    const restored = await db.metrics.where('type').equals('weight').toArray()
    expect(restored.some((m) => m.value === 170)).toBe(true)
    expect(await db.tracks.count()).toBe(6)
  })

  it('rejects a non-Beat-Drew file', async () => {
    await expect(importAll({ app: 'nope' } as never)).rejects.toThrow()
  })
})
