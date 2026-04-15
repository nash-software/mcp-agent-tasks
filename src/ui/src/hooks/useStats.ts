import { useQuery } from '@tanstack/react-query'
import { fetchStats } from '../api'
import type { StatsEntry } from '../types'

export function useStats(): {
  stats: StatsEntry[]
  isLoading: boolean
  error: Error | null
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
  })
  return { stats: data ?? [], isLoading, error: error as Error | null }
}
