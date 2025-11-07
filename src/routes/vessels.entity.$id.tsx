import { createFileRoute, useParams, Link } from '@tanstack/react-router'
import { useEntityRows, useEntitySummary } from '@/features/vessels/hooks'

export const Route = createFileRoute('/vessels/entity/$id')({
  component: EntityPage,
})

function EntityPage() {
  const { id } = useParams({ from: '/vessels/entity/$id' }) as { id: string }
  const { data: summary } = useEntitySummary(id)
  const { data: rows = [], isFetching } = useEntityRows(id)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Entity {id}</h2>
        <Link to="/vessels/search" className="underline text-sm">
          ← Back to search
        </Link>
      </div>

      {summary ? (
        <div className="border rounded p-3">
          <div className="text-sm">Row count: {summary.row_count}</div>
          <div className="text-sm">IMOs: {(summary.imos || []).join(', ')}</div>
          <div className="text-sm">MMSIs: {(summary.mmsis || []).join(', ')}</div>
          <div className="text-sm">Names: {(summary.names || []).slice(0, 6).join(', ')}{(summary.names || []).length > 6 ? '…' : ''}</div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Loading summary…</div>
      )}

      <div className="text-sm text-muted-foreground">{isFetching ? 'Loading rows…' : `${rows.length} rows`}</div>

      {rows.length > 0 && (
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 border-b">IMO</th>
                <th className="text-left px-3 py-2 border-b">MMSI</th>
                <th className="text-left px-3 py-2 border-b">Name</th>
                <th className="text-left px-3 py-2 border-b">RFMO</th>
                <th className="text-left px-3 py-2 border-b">Source File</th>
                <th className="text-left px-3 py-2 border-b">Row#</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i} className="odd:bg-white even:bg-gray-50">
                  <td className="px-3 py-2 border-b">{r.imo}</td>
                  <td className="px-3 py-2 border-b">{r.mmsi}</td>
                  <td className="px-3 py-2 border-b">{r.vessel_name}</td>
                  <td className="px-3 py-2 border-b">{r.rfmo}</td>
                  <td className="px-3 py-2 border-b">{r.source_file}</td>
                  <td className="px-3 py-2 border-b">{r.source_row}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
