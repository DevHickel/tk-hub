// Cliente HTTP isolado para a API externa da TK.
// Centraliza todas as chamadas outbound — quando a TK fornecer a doc oficial,
// só este arquivo precisa ser ajustado (endpoints, headers, autenticação).

export class TKApiClient {
  constructor(private baseUrl: string, private token: string) {}

  /**
   * Baixa o arquivo PDF de um procedimento da TK.
   * STUB: ajustar endpoint/headers conforme doc oficial quando estiver disponível.
   * Esperado: GET {baseUrl}/procedures/:id/file → application/pdf
   */
  async downloadProcedureFile(externalId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/procedures/${encodeURIComponent(externalId)}/file`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) {
      throw new Error(`TK API download failed for ${externalId}: ${res.status} ${res.statusText}`)
    }
    const contentDisposition = res.headers.get('content-disposition') ?? ''
    const match = contentDisposition.match(/filename="?([^";]+)"?/i)
    const fileName = match?.[1]?.trim() ?? `${externalId}.pdf`
    const buffer = Buffer.from(await res.arrayBuffer())
    return { buffer, fileName }
  }

  /**
   * Lista procedimentos modificados após `since` (catch-up via polling).
   * STUB: a ser implementado quando a TK fornecer endpoint correspondente.
   */
  async listProceduresUpdatedSince(_since: string): Promise<Array<{ external_id: string; updated_at: string }>> {
    throw new Error('Not implemented — aguardando doc da API da TK.')
  }
}

/** Factory que lê config ativa do banco e retorna o client pronto. */
export async function getTKClientFromConfig(
  baseUrl: string | null | undefined,
  apiToken: string | null | undefined,
): Promise<TKApiClient | null> {
  if (!baseUrl || !apiToken) return null
  return new TKApiClient(baseUrl, apiToken)
}
