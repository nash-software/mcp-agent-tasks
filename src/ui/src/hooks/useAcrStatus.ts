import { useQuery } from '@tanstack/react-query'
import type { AcrStatusResponse } from '../types'

async function fetchAcrStatus(): Promise<AcrStatusResponse> {
  try {
    const res = await fetch('/api/acr/status')
    if (!res.ok) return { offline: true, jobs: [] }
    return res.json() as Promise<AcrStatusResponse>
  } catch {
    return { offline: true, jobs: [] }
  }
}

export function useAcrStatus(): ReturnType<typeof useQuery<AcrStatusResponse>> {
  return useQuery<AcrStatusResponse>({
    queryKey: ['acr', 'status'],
    queryFn: fetchAcrStatus,
    refetchInterval: (query) => {
      const data = query.state.data
      if (data && !data.offline && data.jobs.some(j => j.status === 'running')) {
        return 5_000
      }
      return 15_000
    },
    staleTime: 4_000,
  })
}
