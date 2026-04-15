import { useQuery } from '@tanstack/react-query'
import { fetchTasks, type TaskFilters } from '../api'
import type { Task } from '../types'

export function useTasks(filters: TaskFilters = {}): {
  tasks: Task[]
  isLoading: boolean
  error: Error | null
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => fetchTasks(filters),
  })
  return { tasks: data ?? [], isLoading, error: error as Error | null }
}
