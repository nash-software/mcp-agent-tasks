import { useQuery } from '@tanstack/react-query'
import { searchBrain } from '../api'
import type { BrainSearchResponse } from '../types'

export function useBrainSearch(query: string): ReturnType<typeof useQuery<BrainSearchResponse>> {
  return useQuery<BrainSearchResponse>({
    queryKey: ['brain-search', query],
    queryFn: () => searchBrain(query),
    enabled: query.trim().length > 0,
    staleTime: 30_000,
  })
}
