import { useEffect, useState } from 'react'
import type { DefinitionsResponse, Generator, Substation } from '../types'

const API_URL = 'https://api.electricitymap.frenchsta.gg/v1/definitions'

let cachedData: DefinitionsResponse | null = null
let fetchPromise: Promise<DefinitionsResponse> | null = null

interface UseDefinitionsResult {
  generators: Generator[]
  substations: Substation[]
  loading: boolean
  error: string | null
}

export function useDefinitions(): UseDefinitionsResult {
  const [generators, setGenerators] = useState<Generator[]>(cachedData?.generators ?? [])
  const [substations, setSubstations] = useState<Substation[]>(cachedData?.substations ?? [])
  const [loading, setLoading] = useState(cachedData === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cachedData) return

    if (!fetchPromise) {
      fetchPromise = fetch(API_URL).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<DefinitionsResponse>
      })
    }

    fetchPromise
      .then((data) => {
        cachedData = data
        setGenerators(data.generators)
        setSubstations(data.substations)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })
  }, [])

  return { generators, substations, loading, error }
}
