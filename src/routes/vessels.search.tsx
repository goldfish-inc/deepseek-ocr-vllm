import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useMemo, useState, useEffect } from 'react'
import { detectInputType, useVesselSearchGQL } from '@/features/vessels/hooks.graphql.ts'
import { createColumnHelper, getCoreRowModel, useReactTable, flexRender } from '@tanstack/react-table'

type Row = {
  entity_id: string
  imo: string | null
  mmsi: string | null
  vessel_name: string | null
  rfmo: string | null
  source_file: string | null
  source_row: number | null
}

export const Route = createFileRoute('/vessels/search' as any)({
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || '',
  }),
  component: VesselsSearch,
})

function VesselsSearch() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/vessels/search' }) as { q: string }
  const [input, setInput] = useState(search.q || '')
  const { data = [], isFetching } = useVesselSearchGQL(search.q)

  useEffect(() => setInput(search.q || ''), [search.q])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate({ to: '/vessels/search', search: { q: input } })
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
  }

  const helper = createColumnHelper<Row>()
  const columns = useMemo(
    () => [
      helper.accessor('entity_id', {
        header: 'Entity',
        cell: (info) => (
          <a className="underline" href={`/vessels/entity/${encodeURIComponent(info.getValue())}`}>{info.getValue()}</a>
        ),
      }),
      helper.accessor('imo', { header: 'IMO' }),
      helper.accessor('mmsi', { header: 'MMSI' }),
      helper.accessor('vessel_name', { header: 'Name' }),
      helper.accessor('rfmo', { header: 'RFMO' }),
      helper.accessor('source_file', { header: 'Source File' }),
      helper.accessor('source_row', { header: 'Row#' }),
    ],
    []
  )

  const table = useReactTable({
    data: data as Row[],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const type = detectInputType(search.q)

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex gap-2 items-center">
        <input
          className="border rounded px-3 py-2 w-full max-w-xl"
          placeholder="Search IMO (7 digits), MMSI (9 digits), or Name"
          value={input}
          onChange={onChange}
        />
        <button className="px-3 py-2 rounded bg-blue-600 text-white" type="submit">
          Search
        </button>
      </form>
      {search.q ? (
        <div className="text-sm text-muted-foreground">
          Query: <code>{search.q}</code> · Type: <code>{type}</code> · {isFetching ? 'Loading…' : `${data.length} rows`}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Enter a query to search</div>
      )}

      {data.length > 0 && (
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="text-left px-3 py-2 border-b">
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="odd:bg-white even:bg-gray-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 border-b">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
