import { supabase } from '../../lib/supabase.js'
import type { WeekMetrics, ExpiringCert } from './hours.calculator.js'

export async function collectWeekMetrics(weekStart: Date, weekEnd: Date): Promise<WeekMetrics> {
  const start = weekStart.toISOString()
  const end   = weekEnd.toISOString()
  const today = new Date().toISOString().split('T')[0]
  const in30  = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

  // ── Batch 1: todas as queries em paralelo ─────────────────────────────────
  const [
    // Métricas gerais
    ragQueriesRes,
    emailsRes,
    cacheRes,
    modelRes,
    // Certificados (processed_certificates)
    totalCertsRes,
    certsWeekRes,
    certsByTypeRes,
    certsExpiringRes,
    certsExpiredRes,
    // Documentos RAG (documents)
    ragDocsTotalRes,
    ragDocsWeekRes,
    totalChunksRes,
    totalCacheRes,
    docsErrorRes,
    docsProcessingRes,
    // Usuários e feedback
    activeUsersRes,
    feedbackRes,
  ] = await Promise.all([
    // ── Métricas gerais ──────────────────────────────────────────────────
    supabase
      .from('chat_history')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', start)
      .lte('created_at', end),

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

    // ── Certificados (processed_certificates) ────────────────────────────
    // Total de certificados aprovados
    supabase
      .from('processed_certificates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'approved'),

    // Certificados adicionados na semana
    supabase
      .from('processed_certificates')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', start)
      .lte('created_at', end),

    // Certificados por tipo (course_name)
    supabase
      .from('processed_certificates')
      .select('course_name')
      .eq('status', 'approved'),

    // Certificados vencendo em até 30 dias
    supabase
      .from('processed_certificates')
      .select('employee_name, expiry_date, course_name, file_name')
      .eq('status', 'approved')
      .not('expiry_date', 'is', null)
      .gte('expiry_date', today)
      .lte('expiry_date', in30)
      .order('expiry_date', { ascending: true }),

    // Certificados já vencidos
    supabase
      .from('processed_certificates')
      .select('employee_name, expiry_date, course_name, file_name')
      .eq('status', 'expired')
      .order('expiry_date', { ascending: true }),

    // ── Documentos RAG (documents) ───────────────────────────────────────
    // Total de documentos RAG (distintos por file_name)
    supabase.rpc('count_rag_documents'),

    // Documentos RAG adicionados na semana
    supabase
      .from('documents')
      .select('file_name')
      .gte('created_at', start)
      .lte('created_at', end),

    // Total de chunks no índice
    supabase
      .from('document_chunks')
      .select('id', { count: 'exact', head: true }),

    // Total de entradas no cache de embeddings
    supabase
      .from('embedding_cache')
      .select('id', { count: 'exact', head: true }),

    // Documentos RAG com erro na semana
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'error')
      .gte('created_at', start)
      .lte('created_at', end),

    // Documentos RAG ainda processando
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'processing'),

    // ── Usuários e feedback ──────────────────────────────────────────────
    supabase
      .from('chat_history')
      .select('user_id')
      .gte('created_at', start)
      .lte('created_at', end),

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

  // ── Certificados: agrupar por tipo ─────────────────────────────────────────
  const typeMap = new Map<string, number>()
  for (const row of (certsByTypeRes.data ?? []) as Array<{ course_name: string | null }>) {
    const t = row.course_name ?? 'Outros'
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
  }
  const certs_by_type = Array.from(typeMap.entries())
    .map(([tipo, count]) => ({ tipo, count }))
    .sort((a, b) => b.count - a.count)

  // ── Certificados: tiers de vencimento ──────────────────────────────────────
  const allExpiring = (certsExpiringRes.data ?? []) as Array<{
    employee_name: string | null; expiry_date: string | null; course_name: string | null; file_name: string | null
  }>
  const expiredCerts = (certsExpiredRes.data ?? []) as Array<{
    employee_name: string | null; expiry_date: string | null; course_name: string | null; file_name: string | null
  }>

  const tiers: WeekMetrics['certs_expiring_tiers'] = {
    expired: expiredCerts.map(toCert),
    day1: [], day3: [], day7: [], day15: [], day30: [],
  }

  for (const doc of allExpiring) {
    const days = Math.ceil((new Date(doc.expiry_date!).getTime() - Date.now()) / 86400000)
    const cert = toCert(doc)
    if (days <= 1) tiers.day1.push(cert)
    else if (days <= 3) tiers.day3.push(cert)
    else if (days <= 7) tiers.day7.push(cert)
    else if (days <= 15) tiers.day15.push(cert)
    else tiers.day30.push(cert)
  }

  // ── Certificados: colaboradores com vencidos ───────────────────────────────
  const collabMap = new Map<string, number>()
  for (const doc of expiredCerts) {
    const name = doc.employee_name ?? 'Desconhecido'
    collabMap.set(name, (collabMap.get(name) ?? 0) + 1)
  }
  const collaborators_with_expired = Array.from(collabMap.entries())
    .map(([colaborador, count]) => ({ colaborador, count }))
    .sort((a, b) => b.count - a.count)

  // ── Documentos RAG: contagem distinta na semana ────────────────────────────
  const ragDocsWeekNames = new Set(
    ((ragDocsWeekRes.data ?? []) as Array<{ file_name: string | null }>)
      .map((r) => r.file_name)
      .filter(Boolean)
  )

  // ── Usuários ativos (distinct) ─────────────────────────────────────────────
  const userIds = new Set(
    ((activeUsersRes.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
  )

  // Top users por queries
  const userQueryMap = new Map<string, number>()
  for (const r of (activeUsersRes.data ?? []) as Array<{ user_id: string }>) {
    userQueryMap.set(r.user_id, (userQueryMap.get(r.user_id) ?? 0) + 1)
  }
  const topUserIds = Array.from(userQueryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

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

  // ── Feedback ───────────────────────────────────────────────────────────────
  const feedbackData = (feedbackRes.data ?? []) as Array<{ score: number }>
  const feedback_positive = feedbackData.filter((f) => f.score > 0).length
  const feedback_negative = feedbackData.filter((f) => f.score < 0).length

  // ── Tokens ─────────────────────────────────────────────────────────────────
  const total_tokens_week = modelUsage.reduce((s, r) => s + (r.tokens_used ?? 0), 0)
  const ragQueries = ragQueriesRes.count ?? 0
  const avg_tokens_per_query = ragQueries > 0 ? Math.round(total_tokens_week / ragQueries) : 0

  return {
    rag_queries:      ragQueries,
    rag_docs_total:   (ragDocsTotalRes.data as unknown as number) ?? 0,
    rag_docs_week:    ragDocsWeekNames.size,
    alerts_sent:      0,
    emails_processed: emailsRes.count ?? 0,
    model_usage:      modelUsage,
    cache_hits:       cacheHits,
    // Certificados
    total_certs:      totalCertsRes.count ?? 0,
    certs_processed_week: certsWeekRes.count ?? 0,
    certs_by_type,
    certs_expiring_tiers: tiers,
    certs_expiring_count: allExpiring.length,
    certs_expired_count:  expiredCerts.length,
    collaborators_with_expired,
    // IT / RAG
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

function toCert(d: { employee_name: string | null; expiry_date: string | null; course_name: string | null; file_name: string | null }): ExpiringCert {
  return { employee_name: d.employee_name, expiry_date: d.expiry_date, course_name: d.course_name, file_name: d.file_name }
}
