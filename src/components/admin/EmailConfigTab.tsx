import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api, type EmailConfig } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { Settings, Send, Mail } from 'lucide-react'

const SMTP_PRESETS: Record<string, { label: string; host: string; port: number }> = {
  gmail:   { label: 'Gmail',        host: 'smtp.gmail.com',       port: 587 },
  outlook: { label: 'Outlook',      host: 'smtp.office365.com',   port: 587 },
  custom:  { label: 'Personalizado', host: '',                     port: 587 },
}

export function EmailConfigTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()

  const { data: remote, isLoading } = useQuery({
    queryKey: ['email-config'],
    queryFn: () => api.getEmailConfig(),
  })

  const [form, setForm] = useState<EmailConfig>({
    smtp_host: '', smtp_port: 587, smtp_user: '', smtp_pass: '',
    from_name: 'TK Solution', from_email: '',
  })
  const [activePreset, setActivePreset] = useState<string | null>(null)

  useEffect(() => {
    if (remote) {
      setForm(remote)
      if (remote.smtp_host === 'smtp.gmail.com') setActivePreset('gmail')
      else if (remote.smtp_host === 'smtp.office365.com') setActivePreset('outlook')
      else if (remote.smtp_host) setActivePreset('custom')
    }
  }, [remote])

  const saveMutation = useMutation({
    mutationFn: () => api.updateEmailConfig(form),
    onSuccess: () => toast({ title: 'Configuração de e-mail salva' }),
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  })

  const testMutation = useMutation({
    mutationFn: () => api.testEmailConfig(),
    onSuccess: (data) => toast({ title: 'Teste enviado', description: data.message }),
    onError: (err: Error) => toast({ title: 'Falha no teste', description: err.message, variant: 'destructive' }),
  })

  const applyPreset = (key: string) => {
    const preset = SMTP_PRESETS[key]
    setActivePreset(key)
    setForm((f) => ({ ...f, smtp_host: preset.host, smtp_port: preset.port }))
  }

  if (isLoading) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
  }

  return (
    <div className="space-y-6 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Provedor de e-mail
          </CardTitle>
          <CardDescription className="text-xs">
            Escolha um provedor ou configure manualmente o servidor SMTP. Esta configuração é usada para envio de relatórios, convites e alertas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {Object.entries(SMTP_PRESETS).map(([key, preset]) => (
              <Button
                key={key}
                variant={activePreset === key ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyPreset(key)}
                disabled={!canEdit}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Configuração SMTP
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Servidor SMTP</Label>
              <Input
                placeholder="smtp.gmail.com"
                value={form.smtp_host}
                onChange={(e) => setForm((f) => ({ ...f, smtp_host: e.target.value }))}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Porta</Label>
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.smtp_port}
                onChange={(e) => setForm((f) => ({ ...f, smtp_port: Number(e.target.value) }))}
                disabled={!canEdit}
                className="w-24"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>E-mail (login SMTP)</Label>
              <Input
                type="email"
                placeholder="usuario@gmail.com"
                value={form.smtp_user}
                onChange={(e) => setForm((f) => ({ ...f, smtp_user: e.target.value }))}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Senha / App Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={form.smtp_pass}
                onChange={(e) => setForm((f) => ({ ...f, smtp_pass: e.target.value }))}
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
            <div className="space-y-1.5">
              <Label>Nome do remetente</Label>
              <Input
                placeholder="TK Solution"
                value={form.from_name}
                onChange={(e) => setForm((f) => ({ ...f, from_name: e.target.value }))}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail do remetente</Label>
              <Input
                type="email"
                placeholder="noreply@tksolution.com.br"
                value={form.from_email}
                onChange={(e) => setForm((f) => ({ ...f, from_email: e.target.value }))}
                disabled={!canEdit}
              />
            </div>
          </div>

          {canEdit && (
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !form.smtp_host || !form.smtp_user}
                className="w-full sm:w-auto"
              >
                {saveMutation.isPending ? 'Salvando...' : 'Salvar configuração'}
              </Button>
              <Button
                variant="outline"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !form.smtp_host || !form.smtp_user}
                className="w-full sm:w-auto"
              >
                <Send className="h-4 w-4 mr-2" />
                {testMutation.isPending ? 'Enviando...' : 'Enviar e-mail de teste'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3 space-y-1">
        <p><strong>Gmail:</strong> Use uma Senha de App (Conta Google → Segurança → Senhas de app). Não funciona com a senha normal se 2FA estiver ativo.</p>
        <p><strong>Outlook:</strong> Use sua senha normal da conta Microsoft.</p>
        <p><strong>Personalizado:</strong> Qualquer servidor SMTP compatível (porta 587 para TLS ou 465 para SSL).</p>
      </div>
    </div>
  )
}
