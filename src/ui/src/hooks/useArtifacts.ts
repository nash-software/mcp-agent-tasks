import { useQuery } from '@tanstack/react-query'
import { getArtifacts } from '../api'
import type { ArtifactEntry } from '../types'

export function useArtifacts(): {
  artifacts: ArtifactEntry[]
  isLoading: boolean
  error: Error | null
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['artifacts'],
    queryFn: () => getArtifacts(),
    refetchInterval: 60_000,
  })
  return { artifacts: data ?? [], isLoading, error: error as Error | null }
}
