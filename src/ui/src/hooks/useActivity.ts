import { useQuery } from '@tanstack/react-query'
import { fetchActivity } from '../api'
import type { ActivityEntry } from '../types'

export function useActivity(): {
  activity: ActivityEntry[]
  isLoading: boolean
  error: Error | null
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['activity'],
    queryFn: fetchActivity,
  })
  return { activity: data ?? [], isLoading, error: error as Error | null }
}
