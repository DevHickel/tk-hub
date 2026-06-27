import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { Copy, RefreshCw, KeyRound, Plug, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function TKIntegrationTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: config, isLoading } = useQuery({
    queryKey: ['tk-sync-config'],
    queryFn: () => api.getTKSyncConfig(),
  })

  const { data: events = [] } = useQuery({
    queryKey: ['tk-sync-events'],
    queryFn: () => api.listTKSyncEvents(),
    refetchInterval: 30_000,
  })

  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [apiToken, setApiToken] = useState<string | null>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)

  const effectiveBaseUrl = baseUrl ?? config?.base_url ?? ''
  const effectiveActive = config?.active ?? false

  const webhookUrl = `${window.location.origin.replace(/^http(s?):\/\//, 'https://')}/api/sync/tk/procedures`
    .replace('http://', 'https://')

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateTKSyncConfig({
        base_url: baseUrl ?? undefined,
        api_token: apiToken ?? undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Configuração salva' })
      setBaseUrl(null)
      setApiToken(null)
      queryClient.invalidateQueries({ queryKey: ['tk-sync-config'] })
    },
    onError: (err: Error) =>
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' }),
  })

  const activeMutation = useMutation({
    mutationFn: (value: boolean) => api.updateTKSyncConfig({ active: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tk-sync-config'] }),
  })

  const rotateMutation = useMutation({
    mutationFn: () => api.rotateTKSecret(),
    onSuccess: (data) => {
      setNewSecret(data.secret)
      queryClient.invalidateQueries({ queryKey: ['tk-sync-config'] })
    },
    onError: (err: Error) =>
      toast({ title: 'Erro ao gerar secret', description: err.message, variant: 'destructive' }),
  })

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: `${label} copiado` })
    } catch {
      toast({ title: 'Falha ao copiar', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Plug className="h-4 w-4" />
            Integração com sistema TK Solution
          </CardTitle>
          <CardDescription className="text-xs">
            Recebe procedimentos da API da TK via webhook e indexa automaticamente no RAG.
            <strong className="block mt-1">Fase 0:</strong> infra pronta para receber.
            Quando a TK fornecer documentação e endpoint, ajusta o cliente em
            <code className="mx-1 px-1 py-0.5 bg-muted rounded text-[10px]">apps/api/src/services/tk-api.client.ts</code>
            e o schema em
            <code className="mx-1 px-1 py-0.5 bg-muted rounded text-[10px]">sync.routes.ts</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-md bg-muted/40">
            <div>
              <p className="text-sm font-medium">Status da integração</p>
              <p className="text-xs text-muted-foreground">
                Quando ativa, o webhook aceita eventos. Mantenha desativada enquanto valida.
              </p>
            </div>
            <Switch
              checked={effectiveActive}
              disabled={!canEdit || activeMutation.isPending}
              onCheckedChange={(v) => activeMutation.mutate(v)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>URL do webhook</Label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => copy(webhookUrl, 'URL')}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Compartilhe com a TK para configurarem o destino do webhook.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Secret do webhook</Label>
            <div className="flex gap-2">
              <Input
                value={config?.has_secret ? '••••••••••••••••' : 'Nenhum secret gerado ainda'}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => rotateMutation.mutate()}
                disabled={!canEdit || rotateMutation.isPending}
              >
                <KeyRound className="h-4 w-4 mr-1" />
                {config?.has_secret ? 'Gerar novo' : 'Gerar secret'}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              A TK deve enviar este secret no header <code>X-TK-Webhook-Secret</code>.
              Ao gerar um novo, o anterior para de funcionar.
            </p>

            {newSecret && (
              <div className="mt-3 p-3 rounded-md border border-amber-500/50 bg-amber-500/10 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <strong>Copie agora.</strong> Este secret só aparece esta vez —
                    o banco guarda apenas o hash. Se perder, gere outro.
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input value={newSecret} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copy(newSecret, 'Secret')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setNewSecret(null)}>
                  Já copiei, esconder
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
            <div className="space-y-1.5">
              <Label>URL base da API da TK (opcional)</Label>
              <Input
                placeholder="https://api.tksolution.com.br"
                value={effectiveBaseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={!canEdit}
              />
              <p className="text-[11px] text-muted-foreground">
                Usada para download de arquivos quando o webhook não envia o PDF
                inline, e futuramente para polling de catch-up.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Token de autenticação (opcional)</Label>
              <Input
                type="password"
                placeholder={config?.api_token_masked || 'Bearer token da API'}
                value={apiToken ?? ''}
                onChange={(e) => setApiToken(e.target.value)}
                disabled={!canEdit}
              />
              <p className="text-[11px] text-muted-foreground">
                {config?.api_token_masked
                  ? `Atual: ${config.api_token_masked}. Deixe vazio para manter.`
                  : 'Token Bearer enviado em chamadas outbound pra TK.'}
              </p>
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end pt-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || (baseUrl === null && apiToken === null)}
              >
                {saveMutation.isPending ? 'Salvando...' : 'Salvar URL e token'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Histórico de eventos
          </CardTitle>
          <CardDescription className="text-xs">
            Últimos 50 webhooks recebidos. Atualiza automaticamente a cada 30s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nenhum evento ainda. Quando a TK começar a chamar o webhook, aparece aqui.
            </p>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>External ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Erro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {format(new Date(e.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{e.event_type}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{e.external_id ?? '—'}</TableCell>
                        <TableCell>{statusBadge(e.status)}</TableCell>
                        <TableCell className="text-xs text-destructive max-w-xs truncate">
                          {e.error_message ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="md:hidden space-y-2">
                {events.map((e) => (
                  <Card key={e.id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-mono truncate">{e.external_id ?? '—'}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {format(new Date(e.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                          </p>
                        </div>
                        {statusBadge(e.status)}
                      </div>
                      <Badge variant="outline" className="text-[10px]">{e.event_type}</Badge>
                      {e.error_message && (
                        <p className="text-xs text-destructive">{e.error_message}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon?: React.ReactNode }> = {
    received: { label: 'Recebido', variant: 'secondary' },
    processed: { label: 'Processado', variant: 'default', icon: <CheckCircle2 className="h-3 w-3 mr-1" /> },
    skipped: { label: 'Duplicado', variant: 'outline' },
    error: { label: 'Erro', variant: 'destructive', icon: <AlertTriangle className="h-3 w-3 mr-1" /> },
  }
  const cfg = map[status] ?? { label: status, variant: 'outline' as const }
  return (
    <Badge variant={cfg.variant} className="text-[10px]">
      {cfg.icon}{cfg.label}
    </Badge>
  )
}
