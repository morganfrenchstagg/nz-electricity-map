import { useEffect, useMemo, useState } from 'react'
import type { Generator, Substation } from '../types'
import { fetchDefinitions, peekDefinitions } from '../api'

interface UseDefinitionsResult {
  generators: Generator[]
  substations: Substation[]
  loading: boolean
  error: string | null
}

export function useDefinitions(): UseDefinitionsResult {
  const [data, setData] = useState(peekDefinitions)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDefinitions()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unknown error'))
  }, [])

  // Map rebuilds its GeoJSON sources whenever these arrays change identity
  return useMemo(() => ({
    generators: data?.generators.filter(g => g.site !== 'SZR') ?? [],
    substations: data?.substations ?? [],
    loading: !data && !error,
    error,
  }), [data, error])
}
