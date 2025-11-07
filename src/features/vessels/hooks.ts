import { useQuery } from '@tanstack/react-query'
import { supabaseVessels } from '@/lib/supabase-vessels'
import { supabase } from '@/lib/supabase'

export type InputType = 'imo' | 'mmsi' | 'name' | 'empty'

export function detectInputType(q: string): InputType {
  const t = (q || '').trim()
  if (!t) return 'empty'
  const numeric = /^\d+$/.test(t)
  if (numeric && t.length === 7) return 'imo'
  if (numeric && t.length === 9) return 'mmsi'
  return 'name'
}

function getClient() {
  // Prefer dedicated vessels client if configured, else default client
  return (supabaseVessels as any) || supabase
}

export function useVesselSearch(q: string) {
  const type = detectInputType(q)
  return useQuery({
    queryKey: ['vessels', 'search', q, type],
    enabled: !!q && type !== 'empty',
    queryFn: async () => {
      const client: any = getClient()
      const baseCols = 'entity_id, imo, mmsi, vessel_name, rfmo, source_file, source_row'
      if (type === 'imo') {
        const { data, error } = await client.from('vessels').select(baseCols).eq('imo', q).limit(200)
        if (error) throw error
        return data ?? []
      }
      if (type === 'mmsi') {
        const { data, error } = await client.from('vessels').select(baseCols).eq('mmsi', q).limit(200)
        if (error) throw error
        return data ?? []
      }
      // Name search: try RPC for trigram/unaccent; fallback to ILIKE
      try {
        const { data, error } = await client.rpc('search_vessels', { q, limit_n: 50 })
        if (error) throw error
        return data ?? []
      } catch (_e) {
        const { data, error } = await client
          .from('vessels')
          .select(baseCols)
          .ilike('vessel_name', `%${q}%`)
          .limit(200)
        if (error) throw error
        return data ?? []
      }
    },
  })
}

export function useEntitySummary(entityId: string) {
  return useQuery({
    queryKey: ['vessels', 'summary', entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const client: any = getClient()
      const { data, error } = await client
        .from('ui_entity_summary')
        .select('entity_id, imos, mmsis, names, row_count')
        .eq('entity_id', entityId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useEntityRows(entityId: string) {
  return useQuery({
    queryKey: ['vessels', 'rows', entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const client: any = getClient()
      const { data, error } = await client
        .from('vessels')
        .select('entity_id, imo, mmsi, vessel_name, rfmo, source_file, source_row')
        .eq('entity_id', entityId)
        .limit(500)
      if (error) throw error
      return data ?? []
    },
  })
}
