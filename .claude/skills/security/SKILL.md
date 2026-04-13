---
name: security
description: Regras de segurança obrigatórias para todo o desenvolvimento da TK Solution — consultar durante e após cada implementação
---

# Segurança — Regras Obrigatórias

Segurança não é revisão final. É aplicada durante o desenvolvimento.
Consultar este arquivo ao criar qualquer rota, service, query ou componente.

---

## 1. Autenticação e Autorização

### Nunca confiar em dados de autorização vindos do request
O userId e role SEMPRE vêm do token JWT verificado, nunca do body ou query string.

```typescript
// ERRADO
app.get('/api/documents', async (c) => {
  const userId = c.req.query('user_id')  // NUNCA
  const role   = c.req.header('x-role')  // NUNCA
})

// CORRETO — extraídos do middleware de auth
app.get('/api/documents', async (c) => {
  const userId = c.get('userId')   // vem do token verificado
  const role   = c.get('userRole') // vem do token verificado
})
```

### Verificar permissão antes de operações sensíveis
Deletar ou arquivar documentos requer role manager ou admin.
Nunca expor essa lógica só no frontend — sempre validar no backend.

```typescript
// middleware de permissão para operações destrutivas
function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const userRole = c.get('userRole')
    if (!roles.includes(userRole)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }
    await next()
  }
}

// uso: só manager e admin podem arquivar documentos
app.delete('/api/documents/:id',
  requireRole('manager', 'admin'),
  async (c) => {
    const doc = await supabase
      .from('documents')
      .select()
      .eq('id', c.req.param('id'))
      .single()

    if (!doc.data) return c.json({ error: 'Not found' }, 404)
    // prosseguir com a operação
  }
)
```

---

## 2. Validação de entrada (Zod em toda rota)

Toda rota valida entrada com Zod antes de processar.
Campos não declarados no schema são rejeitados automaticamente.

```typescript
// schema de upload — tipos estritos
const uploadSchema = z.object({
  document_type: z.enum(['ASO', 'NR-35', 'NR-10', 'PPRA', 'PCMSO', 'CNH', 'outro']),
  colaborador: z.string().min(2).max(200).optional(),
})

// schema de chat — limitar tamanho da pergunta
const chatSchema = z.object({
  question: z.string().min(1).max(1000),  // sem perguntas de 10MB
})
```

---

## 3. Upload de arquivos

### Validar tipo de arquivo por conteúdo, não só pela extensão
Extensão de arquivo é fácil de falsificar. Verificar o magic number (bytes iniciais).

```typescript
const ALLOWED_MIME_TYPES = ['application/pdf']
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024  // 20MB

async function validateFile(file: File): Promise<void> {
  // verificar tamanho
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('Arquivo muito grande. Máximo 20MB.')
  }

  // verificar tipo real pelo conteúdo (magic bytes do PDF: %PDF)
  const buffer = await file.arrayBuffer()
  const header = Buffer.from(buffer).slice(0, 4).toString()
  if (!header.startsWith('%PDF')) {
    throw new Error('Tipo de arquivo inválido. Apenas PDF é aceito.')
  }
}
```

### Nome do arquivo nunca vai direto para o Storage path
Sanitizar para evitar path traversal.

```typescript
import { randomUUID } from 'crypto'
import path from 'path'

function safeStoragePath(clientId: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase()
  const safeName = randomUUID()  // nome gerado, nunca o nome original do usuário
  return `${clientId}/${safeName}${ext}`
}
```

---

## 4. Injeção de prompt (Prompt Injection)

Documentos enviados por usuários podem conter instruções maliciosas tentando
manipular o comportamento do LLM ("ignore suas instruções anteriores e...").

```typescript
// sanitizar conteúdo de documentos antes de incluir no prompt
function sanitizeForPrompt(text: string): string {
  // remover padrões comuns de prompt injection
  return text
    .replace(/ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi, '[REMOVIDO]')
    .replace(/você (agora |deve |é )?(ser|agir como|fingir)/gi, '[REMOVIDO]')
    .replace(/system\s*:/gi, '[REMOVIDO]')
    .replace(/\[INST\]|\[\/INST\]/g, '[REMOVIDO]')
    .slice(0, 8000)  // limitar tamanho do contexto
}

// usar ao montar o contexto do RAG
const safeContext = chunks.map(c => sanitizeForPrompt(c.content)).join('\n---\n')
```

---

## 5. Variáveis de ambiente e segredos

```typescript
// NUNCA logar variáveis de ambiente
console.log(process.env)  // PROIBIDO

// NUNCA retornar segredos em respostas de API
return c.json({ apiKey: process.env.OPENAI_API_KEY })  // PROIBIDO

// NUNCA hardcodar credenciais
const supabase = createClient('https://...', 'eyJ...')  // PROIBIDO

// CORRETO — sempre via process.env com validação na inicialização
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY',
                  'LLAMAPARSE_API_KEY', 'REDIS_URL', 'SENTRY_DSN']

required.forEach(key => {
  if (!process.env[key]) throw new Error(`Variável de ambiente ausente: ${key}`)
})
```

---

## 6. Headers de segurança HTTP

Adicionar no servidor Hono na inicialização:

```typescript
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'

// headers de segurança — bloqueia clickjacking, XSS, sniffing
app.use('*', secureHeaders())

// CORS restrito — só aceita o domínio do frontend
app.use('*', cors({
  origin: process.env.FRONTEND_URL!,  // ex: https://sistema.tksolution.com.br
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowHeaders: ['Authorization', 'Content-Type'],
  credentials: true,
}))
```

---

## 7. SQL e Supabase

### Nunca concatenar strings em queries
Supabase SDK usa prepared statements automaticamente — sempre usar os métodos do SDK.

```typescript
// ERRADO — SQL injection
const { data } = await supabase.rpc(`
  SELECT * FROM documents WHERE name = '${userInput}'
`)

// CORRETO — SDK com prepared statement
const { data } = await supabase
  .from('documents')
  .select()
  .eq('name', userInput)  // escapado automaticamente
  .eq('client_id', clientId)
```

### Service key nunca no frontend
`SUPABASE_SERVICE_KEY` bypassa RLS. Usar APENAS no backend.
Frontend usa `SUPABASE_ANON_KEY` que respeita RLS.

```typescript
// backend — pode usar service key (bypassa RLS porque o backend já validou auth)
const supabase = createClient(url, process.env.SUPABASE_SERVICE_KEY!)

// frontend — APENAS anon key
const supabase = createClient(url, import.meta.env.VITE_SUPABASE_ANON_KEY)
```

---

## 8. Rate limiting e proteção contra abuso

```typescript
// rate limit geral para todas as rotas (proteção DDoS básica)
app.use('*', rateLimiter({
  windowMs: 60 * 1000,
  limit: 200,  // 200 req/min por IP
  keyGenerator: (c) => c.req.header('x-forwarded-for') ?? 'unknown',
}))

// rate limit específico para rotas de IA (proteção de custo)
export const aiRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 60,   // 60 req/min por usuário autenticado
  keyGenerator: (c) => c.get('userId'),
  message: { error: 'Limite de requisições atingido. Tente novamente em 1 minuto.' },
})

// rate limit para autenticação (proteção brute force)
export const authRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  limit: 10,                  // 10 tentativas por IP
  keyGenerator: (c) => c.req.header('x-forwarded-for') ?? 'unknown',
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
})
```

---

## 9. Logs seguros

```typescript
// função de log que nunca expõe dados sensíveis
function safeLog(level: 'info' | 'error' | 'warn', message: string, meta?: object) {
  const safe = meta ? JSON.stringify(meta, (key, value) => {
    const sensitive = ['password', 'token', 'key', 'secret', 'authorization', 'embedding']
    return sensitive.some(s => key.toLowerCase().includes(s)) ? '[REDACTED]' : value
  }) : ''

  console[level](`[${new Date().toISOString()}] ${message}`, safe)
}

// usar em todo o sistema em vez de console.log direto
safeLog('info', 'Documento processado', { documentId, clientId, pages: 3 })
safeLog('error', 'Falha no LlamaParse', { documentId, error: error.message })
```

---

## 10. Webhook do Gmail — verificar autenticidade

```typescript
// webhooks do Gmail vêm do Google — verificar origem
app.post('/api/webhook/gmail', async (c) => {
  // verificar que a requisição veio do Google Pub/Sub
  const token = c.req.query('token')
  if (token !== process.env.GMAIL_WEBHOOK_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // verificar Content-Type
  const contentType = c.req.header('content-type')
  if (!contentType?.includes('application/json')) {
    return c.json({ error: 'Invalid content type' }, 400)
  }

  // processar...
})
```
