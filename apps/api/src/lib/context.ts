// Tipo compartilhado para variáveis de contexto do Hono
// Todas as rotas devem usar Hono<{ Variables: AppVariables }>
export type AppVariables = {
  userId: string
  userEmail: string
  userRole: string
}
