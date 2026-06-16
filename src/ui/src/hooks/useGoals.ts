import { useQuery } from '@tanstack/react-query'
import { fetchGoals } from '../api'
import type { Goal } from '../types'

export function useGoals(): {
  goals: Goal[]
  activeGoals: Goal[]
  isLoading: boolean
  error: Error | null
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['goals'],
    queryFn: fetchGoals,
  })
  const goals = data ?? []
  return {
    goals,
    activeGoals: goals.filter(g => g.status === 'active'),
    isLoading,
    error: error as Error | null,
  }
}
