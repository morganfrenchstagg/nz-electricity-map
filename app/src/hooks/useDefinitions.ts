import { useEffect, useState } from 'react'
import type { DefinitionsResponse, Generator, Substation } from '../types'

const API_URL = 'https://api.electricitymap.frenchsta.gg/v1/definitions'

interface UseDefinitionsResult {
  generators: Generator[]
  substations: Substation[]
  loading: boolean
  error: string | null
}

export function useDefinitions(): UseDefinitionsResult {
  const [generators, setGenerators] = useState<Generator[]>([])
  const [substations, setSubstations] = useState<Substation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    fetch(API_URL, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<DefinitionsResponse>
      })
      .then((data) => {
        setGenerators(data.generators)
        setSubstations(data.substations)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })

    return () => controller.abort()
  }, [])

  return { generators, substations, loading, error }
}
