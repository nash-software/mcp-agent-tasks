import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchMemories, createMemory, patchMemory, deleteMemory, type AdvisorMemory } from '../api'

export function useMemories(): {
  memories: AdvisorMemory[]
  isLoading: boolean
  saveMemory: (content: string, sourceSessionId?: string) => Promise<AdvisorMemory>
  patchMemory: (id: string, pinned: boolean) => Promise<void>
  deleteMemory: (id: string) => Promise<void>
} {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['advisor-memories'],
    queryFn: fetchMemories,
  })

  const saveMut = useMutation({
    mutationFn: ({ content, sourceSessionId }: { content: string; sourceSessionId?: string }) =>
      createMemory(content, sourceSessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['advisor-memories'] })
    },
  })

  const patchMut = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => patchMemory(id, pinned),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['advisor-memories'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMemory(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['advisor-memories'] })
    },
  })

  return {
    memories: data ?? [],
    isLoading,
    saveMemory: (content, sourceSessionId) =>
      saveMut.mutateAsync({ content, sourceSessionId }),
    patchMemory: (id, pinned) => patchMut.mutateAsync({ id, pinned }).then(() => undefined),
    deleteMemory: (id) => deleteMut.mutateAsync(id),
  }
}
