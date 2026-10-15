import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pollWhileVisible } from './poll'

// The tests run in node, so stand in for the bits of `document` that are used
let doc: EventTarget & { visibilityState: DocumentVisibilityState }

function setVisibility(state: DocumentVisibilityState) {
  doc.visibilityState = state
  doc.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
  vi.stubGlobal('document', doc)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pollWhileVisible', () => {
  it('calls load once per interval while the page is visible', () => {
    const load = vi.fn()
    pollWhileVisible(load, 1000)
    expect(load).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('stops while the page is hidden', () => {
    const load = vi.fn()
    pollWhileVisible(load, 1000)
    vi.advanceTimersByTime(1500)
    setVisibility('hidden')
    vi.advanceTimersByTime(60_000)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('loads as soon as the page is visible again, then carries on polling from there', () => {
    const load = vi.fn()
    pollWhileVisible(load, 1000)
    setVisibility('hidden')
    vi.advanceTimersByTime(60_000)
    setVisibility('visible')
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(999)
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("doesn't poll when started on a hidden page until it's shown", () => {
    doc.visibilityState = 'hidden'
    const load = vi.fn()
    pollWhileVisible(load, 1000)
    vi.advanceTimersByTime(60_000)
    expect(load).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does nothing more once stopped', () => {
    const load = vi.fn()
    const stop = pollWhileVisible(load, 1000)
    stop()
    vi.advanceTimersByTime(60_000)
    setVisibility('hidden')
    setVisibility('visible')
    expect(load).not.toHaveBeenCalled()
  })
})
