// Logs seguros — nunca expõe dados sensíveis (security/SKILL.md §9)
const SENSITIVE_KEYS = ['password', 'token', 'key', 'secret', 'authorization', 'embedding']

function redact(meta?: object): string {
  if (!meta) return ''
  return JSON.stringify(meta, (k, v) => {
    return SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s)) ? '[REDACTED]' : v
  })
}

export function safeLog(level: 'info' | 'error' | 'warn', message: string, meta?: object) {
  console[level](`[${new Date().toISOString()}] ${message}`, redact(meta))
}
