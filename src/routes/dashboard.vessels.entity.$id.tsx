import { createFileRoute, useParams, Link } from '@tanstack/react-router'
import { useVesselReportGQL } from '@/features/vessels/hooks.graphql.ts'

export const Route = createFileRoute('/dashboard/vessels/entity/$id' as any)({
  component: EntityPage,
})

function EntityPage() {
  const { id } = useParams({ from: '/dashboard/vessels/entity/$id' as any }) as { id: string }
  const { data, isFetching } = useVesselReportGQL(id)

  const summary = data?.summary
  const rows = data?.rows || []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Entity {id}</h2>
        <Link to={'/dashboard/vessels/search' as any} className="underline text-sm">
          ← Back to search
        </Link>
      </div>

      {summary ? (
        <div className="border rounded p-3 space-y-1">
          <div className="text-sm">Row count: {summary.row_count}</div>
          <div className="text-sm">IMOs: {(summary.imos || []).join(', ')}</div>
          <div className="text-sm">MMSIs: {(summary.mmsis || []).join(', ')}</div>
          <div className="text-sm">Names: {(summary.names || []).slice(0, 6).join(', ')}{(summary.names || []).length > 6 ? '…' : ''}</div>
          <div className="text-sm">RFMOs: {(summary.rfmos || []).join(', ')}</div>
          <div className="text-sm">Conflicts: IMO {summary.has_imo_conflict ? '⚠️' : '—'}, MMSI {summary.has_mmsi_conflict ? '⚠️' : '—'}</div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">{isFetching ? 'Loading summary…' : 'No summary'}</div>
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
