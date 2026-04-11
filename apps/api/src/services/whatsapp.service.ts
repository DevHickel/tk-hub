// Evolution API — WhatsApp (context.md)
import { safeLog } from '../lib/logger.js'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY!

export async function sendWhatsApp(number: string, message: string): Promise<void> {
  const res = await fetch(`${EVOLUTION_URL}/message/sendText/tksolution`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: EVOLUTION_KEY,
    },
    body: JSON.stringify({
      number,
      options: { delay: 0 },
      textMessage: { text: message },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    safeLog('error', 'WhatsApp send failed', { number, status: res.status })
    throw new Error(`WhatsApp error: ${err}`)
  }

  safeLog('info', 'WhatsApp enviado', { number })
}

// Notificação de erro para o número configurado
export async function notifyError(error: Error, context: string): Promise<void> {
  const number = process.env.ERROR_WHATSAPP_NUMBER
  if (!number) return

  const message = `⚠️ *TK Solution — Erro*\n\n*Contexto:* ${context}\n*Erro:* ${error.message}\n*Hora:* ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`

  try {
    await sendWhatsApp(number, message)
  } catch {
    // Não propagar erro de notificação
    safeLog('warn', 'Falha ao notificar erro via WhatsApp', { context })
  }
}
