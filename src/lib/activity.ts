import { supabase } from '@/integrations/supabase/client'

export type ActivityAction =
  | 'message_sent'
  | 'message_feedback_positive'
  | 'message_feedback_negative'
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
      details: (details ?? null) as unknown as undefined,
    })
  } catch {
    // Logging failure must never crash the main flow
  }
}

/** Maps action keys to human-readable Portuguese labels */
export const ACTION_LABELS: Record<string, string> = {
  message_sent: 'Enviou uma mensagem no assistente de IA',
  message_feedback_positive: 'Avaliou uma resposta da IA como positiva',
  message_feedback_negative: 'Avaliou uma resposta da IA como negativa',
  invite_sent: 'Enviou um convite de cadastro por e-mail',
  certificate_uploaded: 'Fez upload de um certificado para extração',
  certificate_deleted: 'Excluiu um certificado do sistema',
  rag_document_uploaded: 'Enviou um documento para a base de conhecimento',
  rag_document_deleted: 'Removeu um documento da base de conhecimento',
  permission_changed: 'Alterou o cargo de um usuário',
  user_login: 'Fez login no sistema',
  user_logout: 'Fez logout do sistema',
  profile_updated: 'Atualizou as informações do perfil',
  // Legacy keys (backward compat)
  document_uploaded: 'Enviou um documento',
  document_deleted: 'Excluiu um documento',
  upload: 'Enviou um documento',
  delete_document: 'Excluiu um documento',
}
