import { useQuery } from '@tanstack/react-query'
import { getAcrStatus } from '../api'
import type { AcrStatusResponse } from '../types'

export function useAcrStatus(): ReturnType<typeof useQuery<AcrStatusResponse>> {
  return useQuery<AcrStatusResponse>({
    queryKey: ['acr-status'],
    queryFn: getAcrStatus,
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
}
