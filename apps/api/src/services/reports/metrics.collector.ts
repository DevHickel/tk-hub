import { supabase } from '../../lib/supabase.js'
import type { WeekMetrics, ExpiringCert } from './hours.calculator.js'

export async function collectWeekMetrics(weekStart: Date, weekEnd: Date): Promise<WeekMetrics> {
  const start = weekStart.toISOString()
  const end   = weekEnd.toISOString()
  const today = new Date().toISOString().split('T')[0]
  const in30  = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

  // Todas as queries em paralelo
  const [
    ragQueriesRes,
    docsProcessedRes,
    docsExpiringRes,
    docsExpiredRes,
    emailsRes,
    cacheRes,
    modelRes,
    totalCertsRes,
    certsWeekRes,
    certsByTypeRes,
    allExpiringRes,
    expiredCertsDetailRes,
  ] = await Promise.all([
    // Métricas gerais (existentes)
    supabase
      .from('chat_history')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', start)
      .lte('created_at', end),

    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('created_at', start)
      .lte('created_at', end),

    supabase
      .from('documents')
      .select('colaborador, data_vencimento')
      .eq('status', 'active')
      .not('data_vencimento', 'is', null)
      .gte('data_vencimento', today)
      .lte('data_vencimento', in30),

    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .lt('data_vencimento', today)
      .eq('status', 'active'),

    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'email')
      .gte('created_at', start)
      .lte('created_at', end),

    supabase
      .from('embedding_cache')
      .select('hit_count')
      .gte('created_at', start),

    supabase
      .from('chat_history')
      .select('model_used, tokens_used')
      .gte('created_at', start)
      .lte('created_at', end),

    // HR: total de certificados ativos
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),

    // HR: certificados processados na semana
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .not('data_vencimento', 'is', null)
      .gte('created_at', start)
      .lte('created_at', end),

    // HR: certificados por tipo
    supabase
      .from('documents')
      .select('tipo')
      .eq('status', 'active')
      .not('tipo', 'is', null),

    // HR: todos os certificados vencendo em até 30 dias (com tipo e file_name)
    supabase
      .from('documents')
      .select('colaborador, data_vencimento, tipo, file_name')
      .eq('status', 'active')
      .not('data_vencimento', 'is', null)
      .gte('data_vencimento', today)
      .lte('data_vencimento', in30)
      .order('data_vencimento', { ascending: true }),

    // HR: certificados já vencidos com detalhe (colaborador + count)
    supabase
      .from('documents')
      .select('colaborador, data_vencimento, tipo, file_name')
      .eq('status', 'active')
      .not('data_vencimento', 'is', null)
      .lt('data_vencimento', today)
      .order('data_vencimento', { ascending: true }),
  ])

  const cacheHits = (cacheRes.data ?? []).reduce(
    (s: number, r: { hit_count: number }) => s + (r.hit_count > 1 ? r.hit_count - 1 : 0),
    0
  )

  // Agrupar certificados por tipo
  const typeMap = new Map<string, number>()
  for (const row of (certsByTypeRes.data ?? []) as Array<{ tipo: string | null }>) {
    const t = row.tipo ?? 'Outros'
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
  }
  const certs_by_type = Array.from(typeMap.entries())
    .map(([tipo, count]) => ({ tipo, count }))
    .sort((a, b) => b.count - a.count)

  // Classificar certificados por faixa de vencimento
  const allExpiring = (allExpiringRes.data ?? []) as Array<{
    colaborador: string | null; data_vencimento: string | null; tipo: string | null; file_name: string | null
  }>
  const expiredCerts = (expiredCertsDetailRes.data ?? []) as Array<{
    colaborador: string | null; data_vencimento: string | null; tipo: string | null; file_name: string | null
  }>

  const tiers: WeekMetrics['certs_expiring_tiers'] = {
    expired: expiredCerts.map(toCert),
    day1: [], day3: [], day7: [], day15: [], day30: [],
  }

  for (const doc of allExpiring) {
    const days = Math.ceil((new Date(doc.data_vencimento!).getTime() - Date.now()) / 86400000)
    const cert = toCert(doc)
    if (days <= 1) tiers.day1.push(cert)
    else if (days <= 3) tiers.day3.push(cert)
    else if (days <= 7) tiers.day7.push(cert)
    else if (days <= 15) tiers.day15.push(cert)
    else tiers.day30.push(cert)
  }

  // Colaboradores com mais certificados vencidos
  const collabMap = new Map<string, number>()
  for (const doc of expiredCerts) {
    const name = doc.colaborador ?? 'Desconhecido'
    collabMap.set(name, (collabMap.get(name) ?? 0) + 1)
  }
  const collaborators_with_expired = Array.from(collabMap.entries())
    .map(([colaborador, count]) => ({ colaborador, count }))
    .sort((a, b) => b.count - a.count)

  return {
    rag_queries:      ragQueriesRes.count ?? 0,
    docs_processed:   docsProcessedRes.count ?? 0,
    alerts_sent:      0,
    emails_processed: emailsRes.count ?? 0,
    model_usage:      (modelRes.data ?? []) as WeekMetrics['model_usage'],
    cache_hits:       cacheHits,
    docs_expiring: (docsExpiringRes.data ?? []).map((d) => ({
      colaborador:      d.colaborador as string | null,
      data_vencimento:  d.data_vencimento as string | null,
    })),
    docs_expired:     docsExpiredRes.count ?? 0,
    // HR
    total_certs:      totalCertsRes.count ?? 0,
    certs_processed_week: certsWeekRes.count ?? 0,
    certs_by_type,
    certs_expiring_tiers: tiers,
    collaborators_with_expired,
  }
}

function toCert(d: { colaborador: string | null; data_vencimento: string | null; tipo: string | null; file_name: string | null }): ExpiringCert {
  return { colaborador: d.colaborador, data_vencimento: d.data_vencimento, tipo: d.tipo, file_name: d.file_name }
}
