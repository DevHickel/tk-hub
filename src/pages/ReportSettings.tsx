import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { api, type ReportConfig, type ReportRecipient } from '@/lib/api'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AppSidebar } from '@/components/AppSidebar'
import { MobileNavTrigger } from '@/components/MobileNavTrigger'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  Settings,
  Users,
  Trash2,
  Plus,
  Send,
  Clock,
  Search,
  Mail,
  BarChart3,
  FileText,
  Timer,
  Monitor,
  ShieldCheck,
  Mails,
  Server,
  Pencil,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'

const REPORT_TYPE_LABELS: Record<string, string> = {
  management: 'Gestão',
  hr: 'RH',
  it: 'TI',
  all: 'Todos',
}

const REPORT_TYPE_COLORS: Record<string, string> = {
  management: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  hr: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  it: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  all: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
}

// ── Defaults (mirrors DEFAULT_BENCHMARKS in hours.calculator.ts) ──────────────
const DEFAULTS: Required<Omit<ReportConfig, 'id' | 'updated_at'>> = {
  language: 'pt',
  hour_cost_brl: 35,
  benchmark_search_min: 8,
  benchmark_doc_process_min: 25,
  benchmark_alert_min: 5,
  benchmark_email_triage_min: 10,
  send_day: 0,
  send_hour: 0,
  monthly_fixed_cost_brl: 0,
}

function calcPreview(cfg: typeof DEFAULTS) {
  // Exemplo semanal hipotético: 50 buscas, 20 docs, 10 alertas, 15 emails
  const sample = { searches: 50, docs: 20, alerts: 10, emails: 15 }
  const minutes =
    sample.searches * cfg.benchmark_search_min +
    sample.docs * cfg.benchmark_doc_process_min +
    sample.alerts * cfg.benchmark_alert_min +
    sample.emails * cfg.benchmark_email_triage_min
  const hours = minutes / 60
  const value = hours * cfg.hour_cost_brl
  return { hours: hours.toFixed(1), value: value.toFixed(2) }
}

// ── Tab 1: Destinatários ─────────────────────────────────────────────────────
function RecipientsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [form, setForm] = useState({ email: '', name: '', report_types: ['management'] as string[] })

  const { data: recipients = [], isLoading } = useQuery({
    queryKey: ['report-recipients'],
    queryFn: () => api.listRecipients(),
  })

  const resetForm = () => {
    setForm({ email: '', name: '', report_types: ['management'] })
    setEditingId(null)
  }

  const toggleType = (type: string) => {
    setForm((f) => {
      if (type === 'all') {
        // Toggle: se já está com 'all', desmarca tudo e volta vazio
        return { ...f, report_types: f.report_types.includes('all') ? [] : ['all'] }
      }
      // Remove 'all' se estiver, depois toggle o tipo individual
      const without = f.report_types.filter((t) => t !== 'all')
      const has = without.includes(type)
      const next = has ? without.filter((t) => t !== type) : [...without, type]
      return { ...f, report_types: next }
    })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const types = form.report_types.includes('all') ? ['all'] : form.report_types
      if (editingId) {
        // Edit: update the existing recipient with the first type, delete+recreate extras
        await api.updateRecipient(editingId, { email: form.email, name: form.name, report_type: types[0] as ReportRecipient['report_type'] })
        // If multiple types selected, create additional recipients
        for (const t of types.slice(1)) {
          await api.addRecipient({ email: form.email, name: form.name, report_type: t as ReportRecipient['report_type'] })
        }
      } else {
        // Create: one recipient per selected type
        for (const t of types) {
          await api.addRecipient({ email: form.email, name: form.name, report_type: t as ReportRecipient['report_type'] })
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-recipients'] })
      setOpen(false)
      resetForm()
      toast({ title: editingId ? 'Destinatário atualizado' : 'Destinatário adicionado' })
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteRecipient(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-recipients'] })
      toast({ title: 'Destinatário removido' })
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  })

  const openEdit = (r: ReportRecipient) => {
    setEditingId(r.id)
    setForm({ email: r.email, name: r.name, report_types: [r.report_type] })
    setOpen(true)
  }

  const openAdd = () => {
    resetForm()
    setOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* Explicação dos tipos de relatório */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4 text-blue-500" />
            Gestão
          </div>
          <p className="text-xs text-muted-foreground">ROI e produtividade: horas e reais economizados, volume de buscas e documentos.</p>
        </div>
        <div className="rounded-lg border bg-card p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-green-500" />
            RH
          </div>
          <p className="text-xs text-muted-foreground">Certificações: alertas de vencimento urgentes e próximos, documentos expirados.</p>
        </div>
        <div className="rounded-lg border bg-card p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Monitor className="h-4 w-4 text-purple-500" />
            TI
          </div>
          <p className="text-xs text-muted-foreground">Infraestrutura IA: custo de tokens por modelo, taxa de cache, consumo total.</p>
        </div>
        <div className="rounded-lg border bg-card p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Mails className="h-4 w-4 text-amber-500" />
            Todos
          </div>
          <p className="text-xs text-muted-foreground">Recebe os 3 relatórios acima em um único envio semanal.</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou e-mail..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
          <p className="text-sm text-muted-foreground shrink-0">
            {recipients.length} destinatário{recipients.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" />
            Adicionar
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : recipients.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Mail className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Nenhum destinatário cadastrado.
            </div>
          ) : (() => {
            const q = searchQuery.toLowerCase().trim()
            const filtered = q
              ? recipients.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
              : recipients
            return (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Nome</th>
                  <th className="px-4 py-3 text-left font-medium">E-mail</th>
                  <th className="px-4 py-3 text-left font-medium">Tipo</th>
                  {canEdit && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-sm">
                      Nenhum resultado para &ldquo;{searchQuery}&rdquo;
                    </td>
                  </tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${REPORT_TYPE_COLORS[r.report_type]}`}>
                        {REPORT_TYPE_LABELS[r.report_type]}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteMutation.mutate(r.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            )
          })()}
        </CardContent>
      </Card>

      {/* Modal adicionar/editar destinatário */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar destinatário' : 'Adicionar destinatário'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                placeholder="João Silva"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input
                type="email"
                placeholder="joao@tksolution.com.br"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de relatório</Label>
              <div className="space-y-2 mt-1">
                {([
                  { value: 'management', label: 'Gestão' },
                  { value: 'hr', label: 'RH' },
                  { value: 'it', label: 'TI' },
                  { value: 'all', label: 'Todos' },
                ] as const).map((opt) => {
                  const isAll = form.report_types.includes('all')
                  const disabled = opt.value !== 'all' && isAll
                  return (
                    <label key={opt.value} className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-40' : ''}`}>
                      <Checkbox
                        checked={form.report_types.includes(opt.value)}
                        disabled={disabled}
                        onCheckedChange={() => toggleType(opt.value)}
                      />
                      {opt.label}
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); resetForm() }}>Cancelar</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!form.email || !form.name || form.report_types.length === 0 || saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Salvando...' : editingId ? 'Salvar' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Tab 2: Benchmarks ────────────────────────────────────────────────────────
function BenchmarksTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: remote } = useQuery({
    queryKey: ['report-config'],
    queryFn: () => api.getReportConfig(),
  })

  const [cfg, setCfg] = useState<typeof DEFAULTS>(DEFAULTS)

  // Sync remote → local when loaded
  useEffect(() => {
    if (remote) {
      setCfg({
        language: remote.language ?? DEFAULTS.language,
        hour_cost_brl: remote.hour_cost_brl ?? DEFAULTS.hour_cost_brl,
        benchmark_search_min: remote.benchmark_search_min ?? DEFAULTS.benchmark_search_min,
        benchmark_doc_process_min: remote.benchmark_doc_process_min ?? DEFAULTS.benchmark_doc_process_min,
        benchmark_alert_min: remote.benchmark_alert_min ?? DEFAULTS.benchmark_alert_min,
        benchmark_email_triage_min: remote.benchmark_email_triage_min ?? DEFAULTS.benchmark_email_triage_min,
        send_day: remote.send_day ?? DEFAULTS.send_day,
        send_hour: remote.send_hour ?? DEFAULTS.send_hour,
        monthly_fixed_cost_brl: remote.monthly_fixed_cost_brl ?? DEFAULTS.monthly_fixed_cost_brl,
      })
    }
  }, [remote])

  const saveMutation = useMutation({
    mutationFn: () => api.updateReportConfig(cfg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-config'] })
      toast({ title: 'Benchmarks salvos' })
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  })

  const preview = calcPreview(cfg)

  const field = (
    label: string,
    key: keyof typeof DEFAULTS,
    unit: string,
    icon: React.ReactNode,
    min = 1,
    max = 120,
  ) => (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        {icon}
        {label}
        <span className="text-muted-foreground font-normal">({unit})</span>
      </Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={cfg[key] as number}
        onChange={(e) => setCfg((c) => ({ ...c, [key]: Number(e.target.value) }))}
        disabled={!canEdit}
        className="w-32"
      />
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Benchmarks form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Timer className="h-4 w-4" />
              Quanto tempo leva sem a IA?
            </CardTitle>
            <CardDescription className="text-xs">
              Estimativa de quanto tempo cada tarefa levaria se feita manualmente, sem o TKzinho.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {field('Consultar um documento técnico', 'benchmark_search_min', 'min', <Search className="h-3.5 w-3.5 text-blue-500" />)}
            {field('Processar e arquivar um documento', 'benchmark_doc_process_min', 'min', <FileText className="h-3.5 w-3.5 text-green-500" />, 1, 120)}
            {field('Verificar e enviar um alerta de vencimento', 'benchmark_alert_min', 'min', <Clock className="h-3.5 w-3.5 text-amber-500" />)}
            {field('Ler e classificar um e-mail com anexo', 'benchmark_email_triage_min', 'min', <Mail className="h-3.5 w-3.5 text-purple-500" />)}
            <div className="space-y-1.5 pt-2 border-t">
              {field('Valor médio da hora de trabalho', 'hour_cost_brl', 'R$', <BarChart3 className="h-3.5 w-3.5 text-rose-500" />, 1, 1000)}
            </div>
            <div className="space-y-1.5 pt-2 border-t">
              <Label className="flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5 text-slate-500" />
                Custo fixo mensal de infraestrutura
                <span className="text-muted-foreground font-normal">(R$)</span>
              </Label>
              <Input
                type="number"
                min={0}
                max={100000}
                step={0.01}
                value={cfg.monthly_fixed_cost_brl}
                onChange={(e) => setCfg((c) => ({ ...c, monthly_fixed_cost_brl: Number(e.target.value) }))}
                disabled={!canEdit}
                className="w-40"
              />
              <p className="text-xs text-muted-foreground">
                Soma de todos os custos fixos: VPS, domínio, licenças, agência de IA, etc. Será dividido por 4,33 para calcular o custo semanal no ROI.
              </p>
            </div>
            {canEdit && (
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="mt-2"
              >
                {saveMutation.isPending ? 'Salvando...' : 'Salvar benchmarks'}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Live preview */}
        <Card className="bg-muted/40">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Simulação de economia semanal
            </CardTitle>
            <CardDescription className="text-xs">
              Com base em 50 consultas, 20 documentos, 10 alertas e 15 e-mails por semana:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">Horas economizadas</span>
                <span className="text-2xl font-bold">{preview.hours}h</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">Valor economizado</span>
                <span className="text-2xl font-bold text-green-600 dark:text-green-400">
                  R$ {Number(preview.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground bg-background rounded-md p-3">
              <strong>Como é calculado:</strong> soma dos minutos poupados em cada ação × custo-hora do colaborador.
              Os dados reais do período são coletados automaticamente no banco toda semana.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ── Tab 3: Preferências ──────────────────────────────────────────────────────
const DAY_LABELS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']

function PreferencesTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: remote } = useQuery({
    queryKey: ['report-config'],
    queryFn: () => api.getReportConfig(),
  })

  const [sendDay, setSendDay] = useState(0)
  const [sendHour, setSendHour] = useState(0)

  useEffect(() => {
    if (remote) {
      setSendDay(remote.send_day ?? 0)
      setSendHour(remote.send_hour ?? 0)
    }
  }, [remote])

  const savePrefsMutation = useMutation({
    mutationFn: () => api.updateReportConfig({ send_day: sendDay, send_hour: sendHour }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-config'] })
      toast({ title: 'Preferências salvas' })
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  })

  const testMutation = useMutation({
    mutationFn: () => api.sendTestReport(),
    onSuccess: (data) => toast({ title: 'Relatório de teste enviado', description: data.message }),
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  })

  return (
    <div className="space-y-6 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Agendamento automático
          </CardTitle>
          <CardDescription className="text-xs">
            Os relatórios semanais são enviados automaticamente no dia e horário escolhidos (horário de Brasília).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <Label>Dia da semana</Label>
              <Select
                value={String(sendDay)}
                onValueChange={(v) => setSendDay(Number(v))}
                disabled={!canEdit}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_LABELS.map((label, i) => (
                    <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Horário</Label>
              <Select
                value={String(sendHour)}
                onValueChange={(v) => setSendHour(Number(v))}
                disabled={!canEdit}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {String(i).padStart(2, '0')}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {canEdit && (
            <Button
              size="sm"
              onClick={() => savePrefsMutation.mutate()}
              disabled={savePrefsMutation.isPending}
            >
              {savePrefsMutation.isPending ? 'Salvando...' : 'Salvar preferências'}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Send className="h-4 w-4" />
            Relatório de teste
          </CardTitle>
          <CardDescription className="text-xs">
            Envia os 3 relatórios agora com os dados da última semana para todos os destinatários configurados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <Button
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
            >
              <Send className="h-4 w-4 mr-2" />
              {testMutation.isPending ? 'Enviando...' : 'Enviar agora'}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Apenas administradores e gestores podem enviar relatórios de teste.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Página principal ─────────────────────────────────────────────────────────
export default function ReportSettings() {
  const { isManager } = useAuth()

  const { collapsed: sidebarCollapsed, toggle: toggleSidebar, schedulePendingCollapse } = useSidebarCollapsed()
  const canEdit = isManager

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} onCollapse={schedulePendingCollapse} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b bg-card flex items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-2 min-w-0">
            <MobileNavTrigger />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">Relatórios</h1>
              <p className="text-xs text-muted-foreground truncate">Destinatários, benchmarks e preferências</p>
            </div>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Tabs defaultValue="recipients">
            <TabsList className="mb-6">
              <TabsTrigger value="recipients" className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Destinatários
              </TabsTrigger>
              <TabsTrigger value="benchmarks" className="flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5" />
                Configurações
              </TabsTrigger>
              <TabsTrigger value="preferences" className="flex items-center gap-1.5">
                <Settings className="h-3.5 w-3.5" />
                Preferências
              </TabsTrigger>
            </TabsList>

            <TabsContent value="recipients">
              <RecipientsTab canEdit={canEdit} />
            </TabsContent>

            <TabsContent value="benchmarks">
              <BenchmarksTab canEdit={canEdit} />
            </TabsContent>

            <TabsContent value="preferences">
              <PreferencesTab canEdit={canEdit} />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}
