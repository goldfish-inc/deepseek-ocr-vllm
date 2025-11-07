import { useQuery } from '@tanstack/react-query'
import { graphileClient } from '@/lib/graphile-client'

export type InputType = 'imo' | 'mmsi' | 'name' | 'empty'

export function detectInputType(q: string): InputType {
  const t = (q || '').trim()
  if (!t) return 'empty'
  const numeric = /^\d+$/.test(t)
  if (numeric && t.length === 7) return 'imo'
  if (numeric && t.length === 9) return 'mmsi'
  return 'name'
}

function mapCamelToSnake(row: any) {
  return {
    entity_id: row.entityId ?? null,
    imo: row.imo ?? null,
    mmsi: row.mmsi ?? null,
    vessel_name: row.vesselName ?? null,
    rfmo: row.rfmo ?? null,
    source_file: row.sourceFile ?? null,
    source_row: row.sourceRow ?? null,
  }
}

function mapReportCamelToSnake(r: any) {
  return {
    entity_id: r.entityId,
    imos: r.imos,
    mmsis: r.mmsis,
    names: r.names,
    rfmos: r.rfmos,
    row_count: r.rowCount,
    imo_count: r.imoCount,
    mmsi_count: r.mmsiCount,
    name_count: r.nameCount,
    has_mmsi_conflict: r.hasMmsiConflict,
    has_imo_conflict: r.hasImoConflict,
    rfmo_row_counts: r.rfmoRowCounts,
  }
}

export function useVesselSearchGQL(q: string) {
  const type = detectInputType(q)
  return useQuery({
    queryKey: ['vessels', 'search', q, type, 'gql'],
    enabled: !!q && type !== 'empty' && !!graphileClient,
    queryFn: async () => {
      if (!graphileClient) return []
      if (type === 'imo') {
        const query = /* GraphQL */ `
          query VesselsByIMO($imo: String!, $first: Int) {
            allVessels(first: $first, filter: { imo: { equalTo: $imo } }) {
              nodes { entityId imo mmsi vesselName rfmo sourceFile sourceRow }
            }
          }
        `
        const data = await graphileClient.request<any>(query, { imo: q, first: 200 })
        return (data?.allVessels?.nodes || []).map(mapCamelToSnake)
      }
      if (type === 'mmsi') {
        const query = /* GraphQL */ `
          query VesselsByMMSI($mmsi: String!, $first: Int) {
            allVessels(first: $first, filter: { mmsi: { equalTo: $mmsi } }) {
              nodes { entityId imo mmsi vesselName rfmo sourceFile sourceRow }
            }
          }
        `
        const data = await graphileClient.request<any>(query, { mmsi: q, first: 200 })
        return (data?.allVessels?.nodes || []).map(mapCamelToSnake)
      }
      const query = /* GraphQL */ `
        query SearchVessels($q: String!, $limitN: Int) {
          searchVessels(q: $q, limitN: $limitN) {
            entityId imo mmsi vesselName rfmo sourceFile sourceRow
          }
        }
      `
      const data = await graphileClient.request<any>(query, { q, limitN: 50 })
      return (data?.searchVessels || []).map(mapCamelToSnake)
    },
  })
}

export function useVesselReportGQL(entityId: string) {
  return useQuery({
    queryKey: ['vessels', 'report', entityId, 'gql'],
    enabled: !!entityId && !!graphileClient,
    queryFn: async () => {
      if (!graphileClient) return null
      const query = /* GraphQL */ `
        query VesselReportWithRows($entityId: String!, $first: Int) {
          vesselReport(pEntityId: $entityId) {
            entityId imos mmsis names rfmos rowCount imoCount mmsiCount nameCount hasMmsiConflict hasImoConflict rfmoRowCounts
            vesselsByEntityId(first: $first) {
              nodes { entityId imo mmsi vesselName rfmo sourceFile sourceRow }
            }
          }
        }
      `
      const resp = await graphileClient.request<any>(query, { entityId, first: 500 })
      const report = resp?.vesselReport
      if (!report) return null
      return {
        summary: mapReportCamelToSnake(report),
        rows: (report?.vesselsByEntityId?.nodes || []).map(mapCamelToSnake),
      }
    },
  })
}
