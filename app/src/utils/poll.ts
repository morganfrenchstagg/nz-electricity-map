// Calls `load` every `ms`, but only while the page is visible: a background tab,
// minimised window or locked screen stops polling until it's seen again. Coming
// back loads straight away rather than waiting out the rest of the interval.
// Returns a function that stops polling.
export function pollWhileVisible(load: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | undefined

  function onVisibilityChange() {
    clearInterval(timer)
    timer = undefined
    if (document.visibilityState === 'visible') {
      load()
      timer = setInterval(load, ms)
    }
  }

  if (document.visibilityState === 'visible') timer = setInterval(load, ms)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
