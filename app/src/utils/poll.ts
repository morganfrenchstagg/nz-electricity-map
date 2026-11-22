// Only while the page is visible (not a background tab, minimised window or locked screen).
// Loads straight away on return rather than waiting out the interval. Returns a stop function.
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
