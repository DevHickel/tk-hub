---
name: dms
description: Regras para o DMS — triagem de emails, extração de campos, vencimentos
---

# DMS — Document Management System

## Filosofia: código primeiro, IA depois

Extrair campos de documento:
1. Regex para datas, tipos, números — zero custo
2. gpt-4o-mini APENAS para o que regex não pegou

## Regex obrigatórios (tentar antes de IA)

```typescript
export const PATTERNS = {
  dates: [
    /válido até[:\s]+(\d{2}\/\d{2}\/\d{4})/gi,
    /vencimento[:\s]+(\d{2}\/\d{2}\/\d{4})/gi,
    /validade[:\s]+(\d{2}\/\d{2}\/\d{4})/gi,
    /(\d{2})\/(\d{2})\/(\d{4})/g,
  ],
  docTypes: {
    'ASO':    /\bASO\b|atestado de saúde ocupacional/i,
    'NR-35':  /\bNR.?35\b|trabalho em altura/i,
    'NR-10':  /\bNR.?10\b|segurança em eletricidade/i,
    'PPRA':   /\bPPRA\b|programa de prevenção de riscos/i,
    'PCMSO':  /\bPCMSO\b/i,
    'CNH':    /\bCNH\b|carteira nacional de habilitação/i,
  },
}
```

## Extração com fallback para IA

```typescript
export async function extractFields(text: string): Promise<DocumentFields> {
  // 1. tentar regex
  const fromRegex = extractWithRegex(text)

  // 2. só chama IA para campos que regex não pegou
  const missingFields = Object.entries(fromRegex)
    .filter(([_, v]) => v === null)
    .map(([k]) => k)

  if (missingFields.length === 0) return fromRegex  // zero custo de IA

  const fromAI = await extractMissingWithMini(text, missingFields)
  return { ...fromRegex, ...fromAI }
}
```

## Fila para emails com anexo

Emails com PDF anexado também vão para fila (emailQueue), não processam no webhook.

```typescript
// webhook recebe email → enfileira → retorna 200 imediatamente
app.post('/api/webhook/gmail', async (c) => {
  const emailData = await parseGmailWebhook(c)

  if (emailData.hasAttachment) {
    await emailQueue.add('process', {
      messageId: emailData.messageId,
      clientId: getClientIdFromEmail(emailData.from),
    })
  }

  return c.json({ received: true })  // Gmail exige resposta rápida
})
```

## Cron de vencimentos

```typescript
// todo dia às 08:00 horário de Brasília
cron.schedule('0 8 * * *', async () => {
  const hoje = new Date()
  const { data: docs } = await supabase
    .from('documents')
    .select('*, collaborators(email, name)')
    .gte('data_vencimento', hoje.toISOString())
    .lte('data_vencimento', addDays(hoje, 30).toISOString())

  for (const doc of docs ?? []) {
    const dias = differenceInDays(new Date(doc.data_vencimento), hoje)
    if ([30, 15, 7, 1].includes(dias)) {
      await sendExpiryEmail(doc, dias)  // template fixo, zero IA
    }
  }
}, { timezone: 'America/Sao_Paulo' })
```

## Templates de email — strings fixas, zero IA

```typescript
export function getExpiryTemplate(docName: string, dias: number, colaborador: string): string {
  return `
    <h2>Documento vencendo em ${dias} dia${dias > 1 ? 's' : ''}</h2>
    <p>O documento <strong>${docName}</strong> do colaborador <strong>${colaborador}</strong>
    vence em ${dias} dia${dias > 1 ? 's' : ''}.</p>
    <p>Acesse o sistema para renovar.</p>
  `
}
```
