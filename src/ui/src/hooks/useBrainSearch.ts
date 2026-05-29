import { useQuery } from '@tanstack/react-query'
import type { BrainSearchResponse } from '../types'

async function fetchBrainSearch(query: string): Promise<BrainSearchResponse> {
  try {
    const res = await fetch(`/api/brain/search?q=${encodeURIComponent(query)}`)
    if (!res.ok) return { results: [], query, offline: true }
    return res.json() as Promise<BrainSearchResponse>
  } catch {
    return { results: [], query, offline: true }
  }
}

export function useBrainSearch(query: string): ReturnType<typeof useQuery<BrainSearchResponse>> {
  return useQuery<BrainSearchResponse>({
    queryKey: ['brain', query],
    queryFn: () => fetchBrainSearch(query),
    enabled: query.trim().length > 0,
    staleTime: 30_000,
  })
}
