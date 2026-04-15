import { useQuery } from '@tanstack/react-query'
import { fetchMilestones } from '../api'
import type { Milestone } from '../types'

export function useMilestones(): {
  milestones: Milestone[]
  isLoading: boolean
  error: Error | null
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['milestones'],
    queryFn: fetchMilestones,
  })
  return { milestones: data ?? [], isLoading, error: error as Error | null }
}
