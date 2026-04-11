import { supabase } from '@/integrations/supabase/client'

export type ActivityAction =
  | 'message_sent'
  | 'invite_sent'
  | 'certificate_uploaded'
  | 'rag_document_uploaded'
  | 'rag_document_deleted'
  | 'certificate_deleted'
  | 'permission_changed'
  | 'user_login'
  | 'user_logout'
  | 'profile_updated'

export async function logActivity(
  userId: string,
  action: ActivityAction,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('activity_logs').insert({
      user_id: userId,
      action,
      details: details ?? null,
    })
  } catch {
    // Logging failure must never crash the main flow
  }
}

/** Maps action keys to human-readable Portuguese labels */
export const ACTION_LABELS: Record<string, string> = {
  message_sent: 'Enviou mensagem no assistente',
  invite_sent: 'Enviou convite de registro',
  certificate_uploaded: 'Enviou certificado',
  rag_document_uploaded: 'Enviou documento para IA',
  rag_document_deleted: 'Excluiu documento da IA',
  certificate_deleted: 'Excluiu certificado',
  permission_changed: 'Alterou permissão de usuário',
  user_login: 'Entrou no sistema',
  user_logout: 'Saiu do sistema',
  profile_updated: 'Atualizou o perfil',
}
