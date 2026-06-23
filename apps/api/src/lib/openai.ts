import OpenAI from 'openai'

// timeout generoso (60s) cobre LLM chamadas longas; maxRetries: 5 aguenta
// quedas de conexão TCP "Premature close" do undici/Easypanel sem propagar 500
// pro usuário. O SDK do OpenAI já retria automaticamente em erros de rede,
// HTTP 408/409/429 e 5xx — só precisamos aumentar o teto.
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  timeout: 60_000,
  maxRetries: 5,
})
