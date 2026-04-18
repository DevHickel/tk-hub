import { supabase } from '../../lib/supabase.js'
import type { WeekMetrics, ExpiringCert } from './hours.calculator.js'

export async function collectWeekMetrics(weekStart: Date, weekEnd: Date): Promise<WeekMetrics> {
  const start = weekStart.toISOString()
  const end   = weekEnd.toISOString()
  const today = new Date().toISOString().split('T')[0]
  const in30  = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

  // ── Batch 1: queries gerais + HR + IT ──────────────────────────────────────
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
    // IT-specific
    totalChunksRes,
    totalCacheRes,
    docsErrorRes,
    docsProcessingRes,
    activeUsersRes,
    feedbackRes,
  ] = await Promise.all([
    // Métricas gerais
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

    // HR: todos os certificados vencendo em até 30 dias
    supabase
      .from('documents')
      .select('colaborador, data_vencimento, tipo, file_name')
      .eq('status', 'active')
      .not('data_vencimento', 'is', null)
      .gte('data_vencimento', today)
      .lte('data_vencimento', in30)
      .order('data_vencimento', { ascending: true }),

    // HR: certificados já vencidos
    supabase
      .from('documents')
      .select('colaborador, data_vencimento, tipo, file_name')
      .eq('status', 'active')
      .not('data_vencimento', 'is', null)
      .lt('data_vencimento', today)
      .order('data_vencimento', { ascending: true }),

    // IT: total de chunks no índice RAG
    supabase
      .from('document_chunks')
      .select('id', { count: 'exact', head: true }),

    // IT: total de entradas no cache de embeddings
    supabase
      .from('embedding_cache')
      .select('id', { count: 'exact', head: true }),

    // IT: documentos com erro na semana
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'error')
      .gte('created_at', start)
      .lte('created_at', end),

    // IT: documentos ainda processando (possível travamento)
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'processing'),

    // IT: usuários ativos na semana (distinct user_id)
    supabase
      .from('chat_history')
      .select('user_id')
      .gte('created_at', start)
      .lte('created_at', end),

    // IT: feedback de chunks na semana
    supabase
      .from('chunk_feedback')
      .select('score')
      .gte('created_at', start)
      .lte('created_at', end),
  ])

  // ── Processar métricas gerais ──────────────────────────────────────────────
  const cacheHits = (cacheRes.data ?? []).reduce(
    (s: number, r: { hit_count: number }) => s + (r.hit_count > 1 ? r.hit_count - 1 : 0),
    0
  )

  const modelUsage = (modelRes.data ?? []) as WeekMetrics['model_usage']

  // ── HR: agrupar certificados ───────────────────────────────────────────────
  const typeMap = new Map<string, number>()
  for (const row of (certsByTypeRes.data ?? []) as Array<{ tipo: string | null }>) {
    const t = row.tipo ?? 'Outros'
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
  }
  const certs_by_type = Array.from(typeMap.entries())
    .map(([tipo, count]) => ({ tipo, count }))
    .sort((a, b) => b.count - a.count)

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

  const collabMap = new Map<string, number>()
  for (const doc of expiredCerts) {
    const name = doc.colaborador ?? 'Desconhecido'
    collabMap.set(name, (collabMap.get(name) ?? 0) + 1)
  }
  const collaborators_with_expired = Array.from(collabMap.entries())
    .map(([colaborador, count]) => ({ colaborador, count }))
    .sort((a, b) => b.count - a.count)

  // ── IT: calcular métricas ──────────────────────────────────────────────────
  // Usuários ativos (distinct)
  const userIds = new Set(
    ((activeUsersRes.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
  )

  // Top users por queries — precisamos buscar com nomes
  const userQueryMap = new Map<string, number>()
  for (const r of (activeUsersRes.data ?? []) as Array<{ user_id: string }>) {
    userQueryMap.set(r.user_id, (userQueryMap.get(r.user_id) ?? 0) + 1)
  }
  const topUserIds = Array.from(userQueryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  // Buscar nomes dos top users
  let top_users: WeekMetrics['top_users'] = []
  if (topUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', topUserIds.map(([id]) => id))

    const nameMap = new Map<string, string>()
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      nameMap.set(p.id, p.full_name ?? 'Usuário')
    }

    top_users = topUserIds.map(([id, queries]) => ({
      user_id: id,
      name: nameMap.get(id) ?? 'Usuário',
      queries,
    }))
  }

  // Feedback
  const feedbackData = (feedbackRes.data ?? []) as Array<{ score: number }>
  const feedback_positive = feedbackData.filter((f) => f.score > 0).length
  const feedback_negative = feedbackData.filter((f) => f.score < 0).length

  // Tokens
  const total_tokens_week = modelUsage.reduce((s, r) => s + (r.tokens_used ?? 0), 0)
  const ragQueries = ragQueriesRes.count ?? 0
  const avg_tokens_per_query = ragQueries > 0 ? Math.round(total_tokens_week / ragQueries) : 0

  return {
    rag_queries:      ragQueries,
    docs_processed:   docsProcessedRes.count ?? 0,
    alerts_sent:      0,
    emails_processed: emailsRes.count ?? 0,
    model_usage:      modelUsage,
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
    // IT
    total_chunks:       totalChunksRes.count ?? 0,
    total_cache_entries: totalCacheRes.count ?? 0,
    docs_error_week:    docsErrorRes.count ?? 0,
    docs_processing:    docsProcessingRes.count ?? 0,
    active_users:       userIds.size,
    top_users,
    feedback_positive,
    feedback_negative,
    avg_tokens_per_query,
    total_tokens_week,
  }
}

function toCert(d: { colaborador: string | null; data_vencimento: string | null; tipo: string | null; file_name: string | null }): ExpiringCert {
  return { colaborador: d.colaborador, data_vencimento: d.data_vencimento, tipo: d.tipo, file_name: d.file_name }
}
