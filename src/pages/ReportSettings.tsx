import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { api, type ReportConfig, type ReportRecipient } from '@/lib/api'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AppSidebar } from '@/components/AppSidebar'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
} from 'lucide-react'

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
  const [form, setForm] = useState({ email: '', name: '', report_type: 'management' as ReportRecipient['report_type'] })

  const { data: recipients = [], isLoading } = useQuery({
    queryKey: ['report-recipients'],
    queryFn: () => api.listRecipients(),
  })

  const addMutation = useMutation({
    mutationFn: () => api.addRecipient(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-recipients'] })
      setOpen(false)
      setForm({ email: '', name: '', report_type: 'management' })
      toast({ title: 'Destinatário adicionado' })
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

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {recipients.length} destinatário{recipients.length !== 1 ? 's' : ''} cadastrado{recipients.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setOpen(true)}>
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
          ) : (
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
                {recipients.map((r) => (
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
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMutation.mutate(r.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Modal adicionar destinatário */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar destinatário</DialogTitle>
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
              <Select
                value={form.report_type}
                onValueChange={(v) => setForm((f) => ({ ...f, report_type: v as ReportRecipient['report_type'] }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="management">Gestão</SelectItem>
                  <SelectItem value="hr">RH</SelectItem>
                  <SelectItem value="it">TI</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={!form.email || !form.name || addMutation.isPending}
            >
              {addMutation.isPending ? 'Salvando...' : 'Adicionar'}
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

  const [language, setLanguage] = useState<'pt' | 'en'>('pt')
  const [sendDay, setSendDay] = useState(0)
  const [sendHour, setSendHour] = useState(0)

  useEffect(() => {
    if (remote) {
      if (remote.language) setLanguage(remote.language as 'pt' | 'en')
      setSendDay(remote.send_day ?? 0)
      setSendHour(remote.send_hour ?? 0)
    }
  }, [remote])

  const savePrefsMutation = useMutation({
    mutationFn: () => api.updateReportConfig({ language, send_day: sendDay, send_hour: sendHour }),
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
          <div className="space-y-1.5">
            <Label>Idioma dos relatórios</Label>
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as 'pt' | 'en')}
              disabled={!canEdit}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pt">Português (BR)</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
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
  const { isAdmin, profile } = useAuth()

  const { collapsed: sidebarCollapsed, toggle: toggleSidebar, schedulePendingCollapse } = useSidebarCollapsed()
  const canEdit = isAdmin || ['manager', 'tk_master'].includes((profile as { role?: string })?.role ?? '')

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} onCollapse={schedulePendingCollapse} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b bg-card flex items-center justify-between px-6">
          <div>
            <h1 className="text-lg font-semibold">Relatórios</h1>
            <p className="text-xs text-muted-foreground">Destinatários, benchmarks e preferências</p>
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
                Economia de tempo
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
