import React, { useState, useEffect } from 'react'
import { useBrainSearch } from '../hooks/useBrainSearch'
import type { BrainResult } from '../types'

function ResultRow({ result }: { result: BrainResult }): React.JSX.Element {
  const snippet = result.snippet.length > 150
    ? result.snippet.slice(0, 150) + '…'
    : result.snippet

  return (
    <div className="px-3 py-2 rounded bg-slate-800 space-y-0.5">
      <div className="flex items-center gap-1.5">
        {result.type === 'note' && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-900/40 text-amber-400 shrink-0">
            Note
          </span>
        )}
        <p className="text-sm font-semibold text-slate-200 truncate">{result.title}</p>
      </div>
      <p className="text-xs text-slate-400">{snippet}</p>
      {result.source && (
        <a
          href={result.source}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-slate-300 truncate block"
        >
          {result.source}
        </a>
      )}
    </div>
  )
}

export function BrainSearch(): React.JSX.Element {
  const [inputValue, setInputValue] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(inputValue)
    }, 400)
    return () => clearTimeout(timer)
  }, [inputValue])

  const { data, isLoading } = useBrainSearch(debouncedQuery)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-3 py-2 rounded bg-slate-800 focus-within:ring-1 focus-within:ring-slate-500">
        <span className="text-slate-400 text-sm select-none">&#128269;</span>
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder="Search knowledge base…"
          className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none"
        />
      </div>

      {debouncedQuery.trim().length > 0 && (
        <div className="space-y-1">
          {isLoading && (
            <p className="text-slate-500 text-xs italic px-1">Searching…</p>
          )}

          {!isLoading && data?.offline && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-slate-700 text-slate-400">
              Brain unavailable
            </span>
          )}

          {!isLoading && data && !data.offline && data.results.length === 0 && (
            <p className="text-slate-500 text-xs italic px-1">
              No results for &lsquo;{debouncedQuery}&rsquo;
            </p>
          )}

          {!isLoading && data && !data.offline && data.results.length > 0 && (
            <div className="space-y-1">
              {data.results.slice(0, 5).map((result, idx) => (
                <ResultRow key={idx} result={result} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
