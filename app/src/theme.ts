import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

// Where the theme the viewer picked is kept. Without one, the page is light.
// index.html's inline script reads it too, to set the theme before first paint.
const STORAGE_KEY = 'theme'

const listeners = new Set<() => void>()

function storedTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

// The theme on the page: index.css's colours follow data-theme, and Highcharts'
// follow its highcharts-light or highcharts-dark class
function apply(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('highcharts-dark', theme === 'dark')
  root.classList.toggle('highcharts-light', theme === 'light')
  listeners.forEach((listener) => listener())
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

// Picked by the viewer, so kept for their next visit
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage blocked: the theme still changes for this visit
  }
  apply(theme)
}

export function initTheme() {
  apply(storedTheme())
}

export function useTheme(): Theme {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, currentTheme)
}
