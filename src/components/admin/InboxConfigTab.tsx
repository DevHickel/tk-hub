import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { api, type CertificateInbox } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, RefreshCw, Trash2, Plus, Mail } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const IMAP_PRESETS: Record<string, { host: string; port: number; tls: boolean }> = {
  gmail:     { host: 'imap.gmail.com',        port: 993, tls: true },
  outlook:   { host: 'outlook.office365.com', port: 993, tls: true },
  hostinger: { host: 'imap.hostinger.com',    port: 993, tls: true },
  custom:    { host: '',                      port: 993, tls: true },
}

export function InboxConfigTab({ canEdit }: { canEdit: boolean }) {
  const [inboxes, setInboxes] = useState<CertificateInbox[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [preset, setPreset] = useState('custom')
  const [form, setForm] = useState({
    label: '',
    imap_host: '',
    imap_port: 993,
    imap_user: '',
    imap_pass: '',
    use_tls: true,
  })

  useEffect(() => { fetchInboxes() }, [])

  const fetchInboxes = async () => {
    setLoading(true)
    try {
      const data = await api.listCertificateInboxes()
      setInboxes(data)
    } catch (err) {
      toast.error('Erro ao carregar contas de email.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const applyPreset = (key: string) => {
    setPreset(key)
    const p = IMAP_PRESETS[key] ?? IMAP_PRESETS.custom
    setForm(f => ({ ...f, imap_host: p.host, imap_port: p.port, use_tls: p.tls }))
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const result = await api.testCertificateInbox({
        imap_host: form.imap_host,
        imap_port: form.imap_port,
        imap_user: form.imap_user,
        imap_pass: form.imap_pass,
        use_tls: form.use_tls,
      })
      if (result.success) toast.success(result.message ?? 'Conexão IMAP OK!')
      else toast.error(result.error ?? 'Falha na conexão.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!form.label || !form.imap_host || !form.imap_user || !form.imap_pass) {
      toast.error('Preencha todos os campos obrigatórios.')
      return
    }
    setSaving(true)
    try {
      await api.createCertificateInbox({
        label: form.label,
        imap_host: form.imap_host,
        imap_port: form.imap_port,
        imap_user: form.imap_user,
        imap_pass: form.imap_pass,
        use_tls: form.use_tls,
        active: true,
      })
      toast.success('Conta de email adicionada!')
      setForm({ label: '', imap_host: '', imap_port: 993, imap_user: '', imap_pass: '', use_tls: true })
      setPreset('custom')
      fetchInboxes()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (inbox: CertificateInbox) => {
    try {
      await api.updateCertificateInbox(inbox.id, { active: !inbox.active })
      setInboxes(prev => prev.map(i => i.id === inbox.id ? { ...i, active: !i.active } : i))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await api.deleteCertificateInbox(id)
      setInboxes(prev => prev.filter(i => i.id !== id))
      toast.success('Conta removida.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Caixas de entrada IMAP monitoradas para captura automática de certificados. Verificadas a cada 10 minutos.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : inboxes.length > 0 ? (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Contas configuradas</Label>
          {inboxes.map(inbox => (
            <div key={inbox.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{inbox.label}</p>
                <p className="text-xs text-muted-foreground truncate">{inbox.imap_user}</p>
                <div className="flex items-center gap-2 mt-1">
                  {inbox.active ? (
                    <Badge variant="default" className="text-[10px] h-4">Ativo</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] h-4">Inativo</Badge>
                  )}
                  {inbox.last_checked_at && (
                    <span className="text-[10px] text-muted-foreground">
                      Verificado {formatDistanceToNow(new Date(inbox.last_checked_at), { addSuffix: true, locale: ptBR })}
                    </span>
                  )}
                  {inbox.last_error && (
                    <span className="text-[10px] text-destructive truncate max-w-[150px]" title={inbox.last_error}>
                      Erro: {inbox.last_error}
                    </span>
                  )}
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <Switch
                    checked={inbox.active}
                    onCheckedChange={() => handleToggle(inbox)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    disabled={deletingId === inbox.id}
                    onClick={() => handleDelete(inbox.id)}
                  >
                    {deletingId === inbox.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-4">
          Nenhuma conta configurada. Adicione abaixo.
        </p>
      )}

      {canEdit && (
        <div className="space-y-4 border-t pt-4">
          <Label className="text-sm font-medium">Adicionar nova conta</Label>

          <div className="space-y-2">
            <Label className="text-xs">Provedor</Label>
            <Select value={preset} onValueChange={applyPreset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gmail">Gmail</SelectItem>
                <SelectItem value="outlook">Outlook / Office 365</SelectItem>
                <SelectItem value="hostinger">Hostinger</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Nome da conta *</Label>
            <Input
              placeholder="Ex: Certificados RH"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-2">
              <Label className="text-xs">Servidor IMAP *</Label>
              <Input
                placeholder="imap.exemplo.com"
                value={form.imap_host}
                onChange={e => setForm(f => ({ ...f, imap_host: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Porta</Label>
              <Input
                type="number"
                value={form.imap_port}
                onChange={e => setForm(f => ({ ...f, imap_port: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">E-mail / Usuário *</Label>
            <Input
              placeholder="certificados@empresa.com"
              value={form.imap_user}
              onChange={e => setForm(f => ({ ...f, imap_user: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Senha *</Label>
            <Input
              type="password"
              placeholder="Senha ou senha de app"
              value={form.imap_pass}
              onChange={e => setForm(f => ({ ...f, imap_pass: e.target.value }))}
            />
            {preset === 'gmail' && (
              <p className="text-[10px] text-muted-foreground">
                Para Gmail, use uma Senha de App (myaccount.google.com &gt; Segurança &gt; Senhas de app).
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="use-tls"
              checked={form.use_tls}
              onCheckedChange={v => setForm(f => ({ ...f, use_tls: v }))}
            />
            <Label htmlFor="use-tls" className="text-xs">Usar TLS/SSL</Label>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              disabled={testing || !form.imap_host || !form.imap_user || !form.imap_pass}
              onClick={handleTest}
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Testar conexão
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={saving || !form.label || !form.imap_host || !form.imap_user || !form.imap_pass}
              onClick={handleSave}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Adicionar
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Certificados em PDF, JPEG ou PNG anexados aos e-mails serão extraídos automaticamente pela IA.
          </p>
        </div>
      )}
    </div>
  )
}
