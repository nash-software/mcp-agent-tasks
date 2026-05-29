import { useMutation, useQueryClient } from '@tanstack/react-query'
import { brainDump, commitCandidates, acrDispatch } from '../api'
import type { BrainDumpCandidate } from '../api'

export type { BrainDumpCandidate }

export function useBrainDump() {
  const queryClient = useQueryClient()

  const parseMutation = useMutation({
    mutationFn: (text: string) => brainDump(text),
  })

  const commitMutation = useMutation({
    mutationFn: (candidates: BrainDumpCandidate[]) => commitCandidates(candidates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const dispatchMutation = useMutation({
    mutationFn: ({ title, detail }: { title: string; detail: string }) =>
      acrDispatch(title, detail),
  })

  return { parseMutation, commitMutation, dispatchMutation }
}
