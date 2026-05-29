import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchToday, scheduleTask } from '../api'
import type { TodayResponse } from '../types'

export function useToday(targetMinutes?: number): {
  data: TodayResponse | null
  isLoading: boolean
  error: Error | null
  scheduleForToday: (taskId: string) => Promise<void>
  removeFromToday: (taskId: string) => Promise<void>
} {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['today', targetMinutes],
    queryFn: () => fetchToday(targetMinutes),
    staleTime: 15000,
    refetchInterval: 30000,
  })

  const today = new Date().toISOString().slice(0, 10)

  async function scheduleForToday(taskId: string): Promise<void> {
    await scheduleTask(taskId, today)
    await queryClient.invalidateQueries({ queryKey: ['today'] })
  }

  async function removeFromToday(taskId: string): Promise<void> {
    await scheduleTask(taskId, null)
    await queryClient.invalidateQueries({ queryKey: ['today'] })
  }

  return {
    data: data ?? null,
    isLoading,
    error: error as Error | null,
    scheduleForToday,
    removeFromToday,
  }
}
