import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from '@/components/AppSidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FileText,
  Search,
  Upload,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronLeft,
  ChevronRight,
  FileCheck,
  Loader2,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { logActivity } from '@/lib/activity';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Certificate {
  id: string;
  employee_name: string | null;
  course_name: string | null;
  completion_date: string | null;
  expiry_date: string | null;
  hours: number | null;
  file_name: string | null;
  file_url: string | null;
  status: string | null;
  rejection_reason: string | null;
  created_at: string | null;
}


const CERT_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
  approved:   { label: 'Aprovado', variant: 'default', icon: <CheckCircle2 className="h-3 w-3" /> },
  pending:    { label: 'Pendente', variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
  processing: { label: 'Extraindo...', variant: 'secondary', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  rejected:   { label: 'Rejeitado', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
  expired:    { label: 'Vencido', variant: 'outline', icon: <AlertTriangle className="h-3 w-3" /> },
  error:      { label: 'Erro', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
};

const RAG_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  active:     { label: 'Ativo', variant: 'default' },
  queued:     { label: 'Na fila', variant: 'secondary' },
  processing: { label: 'Processando', variant: 'secondary' },
  error:      { label: 'Erro', variant: 'destructive' },
  archived:   { label: 'Arquivado', variant: 'outline' },
};

const PAGE_SIZE = 20;

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Documents() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading) return;
    if (!user) navigate('/login');
  }, [user, authLoading]);

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b bg-card flex items-center justify-between px-6 shrink-0">
          <div>
            <h1 className="text-lg font-semibold">Documentos</h1>
            <p className="text-xs text-muted-foreground">Gerencie certificados e documentos RAG</p>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Tabs defaultValue="certificados" className="space-y-4">
            <TabsList>
              <TabsTrigger value="certificados" className="gap-2">
                <FileCheck className="h-4 w-4" />
                Certificados
              </TabsTrigger>
              <TabsTrigger value="rag" className="gap-2">
                <FileText className="h-4 w-4" />
                Documentos RAG
              </TabsTrigger>
            </TabsList>

            <TabsContent value="certificados">
              <CertificatesTab />
            </TabsContent>

            <TabsContent value="rag">
              <RagTab />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}

// ─── Certificates Tab ────────────────────────────────────────────────────────

function CertificatesTab() {
  const { user } = useAuth();
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expiryFilter, setExpiryFilter] = useState('all');
  const [selected, setSelected] = useState<Certificate | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setPage(0); }, [search, statusFilter, expiryFilter]);
  useEffect(() => { fetchCerts(); }, [page, search, statusFilter, expiryFilter]);

  const fetchCerts = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('processed_certificates')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search.trim()) {
        query = query.or(`employee_name.ilike.%${search}%,course_name.ilike.%${search}%,file_name.ilike.%${search}%`);
      }
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (expiryFilter === 'expiring30') {
        const now = new Date();
        const in30 = new Date(now);
        in30.setDate(in30.getDate() + 30);
        query = query.gte('expiry_date', now.toISOString().split('T')[0]).lte('expiry_date', in30.toISOString().split('T')[0]);
      } else if (expiryFilter === 'expired') {
        query = query.lt('expiry_date', new Date().toISOString().split('T')[0]);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      setCerts((data as Certificate[]) ?? []);
      setTotal(count ?? 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error('Formato inválido. Use PDF, JPEG ou PNG.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 10MB.');
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      // path: userId/timestamp.ext — first folder = userId for delete policy
      const path = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from('certificates').upload(path, file);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('certificates').getPublicUrl(path);

      const { data: certRow, error: dbError } = await supabase
        .from('processed_certificates')
        .insert({ file_name: file.name, file_url: publicUrl, status: 'pending', org_id: null })
        .select('id')
        .single();
      if (dbError) throw dbError;

      // Trigger background AI extraction
      const { data: { session } } = await supabase.auth.getSession();
      const apiUrl = import.meta.env.VITE_API_URL;
      await fetch(`${apiUrl}/api/certificates/${certRow.id}/extract`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file_url: publicUrl, file_name: file.name }),
      });

      toast.success('Certificado enviado! Extraindo dados automaticamente...');
      await logActivity(user.id, 'certificate_uploaded', { file_name: file.name });
      await fetchCerts();
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao enviar certificado: ${msg}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteCert = async (cert: Certificate, e: React.MouseEvent) => {
    e.stopPropagation(); // prevent opening the detail sheet
    if (!confirm(`Excluir o certificado "${cert.file_name ?? cert.course_name}"? Esta ação não pode ser desfeita.`)) return;
    setDeletingId(cert.id);
    try {
      const { error } = await supabase.from('processed_certificates').delete().eq('id', cert.id);
      if (error) throw error;
      if (selected?.id === cert.id) setSelected(null);
      toast.success('Certificado excluído.');
      if (user) await logActivity(user.id, 'certificate_deleted', { file_name: cert.file_name ?? cert.course_name ?? '' });
      await fetchCerts();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao excluir certificado.');
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const expiryBadge = (dateStr: string | null) => {
    if (!dateStr) return null;
    const days = differenceInDays(new Date(dateStr), new Date());
    if (days < 0) return <Badge variant="outline" className="border-red-500 text-red-500 text-xs">Vencido</Badge>;
    if (days <= 7) return <Badge variant="outline" className="border-red-500 text-red-600 text-xs">{days}d</Badge>;
    if (days <= 30) return <Badge variant="outline" className="border-amber-500 text-amber-600 text-xs">{days}d</Badge>;
    return <span className="text-sm text-muted-foreground">{format(new Date(dateStr), 'dd/MM/yyyy')}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Upload + filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por colaborador, curso ou arquivo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="approved">Aprovado</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="rejected">Rejeitado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={expiryFilter} onValueChange={setExpiryFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Vencimento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os vencimentos</SelectItem>
                <SelectItem value="expiring30">Vencendo em 30 dias</SelectItem>
                <SelectItem value="expired">Vencidos</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2 shrink-0">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? 'Enviando...' : 'Enviar Certificado'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Formatos aceitos: PDF, JPEG, PNG • Máximo 10MB • {total} certificado{total !== 1 ? 's' : ''} no sistema
          </p>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead>Curso / Documento</TableHead>
                <TableHead>Conclusão</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Carga (h)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : certs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
                    <FileCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    Nenhum certificado encontrado.<br />
                    <span className="text-xs">Clique em "Enviar Certificado" para adicionar.</span>
                  </TableCell>
                </TableRow>
              ) : (
                certs.map((cert) => {
                  const cfg = CERT_STATUS[cert.status ?? ''] ?? { label: cert.status ?? '—', variant: 'outline' as const, icon: null };
                  const isDeleting = deletingId === cert.id;
                  return (
                    <TableRow key={cert.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(cert)}>
                      <TableCell className="font-medium">{cert.employee_name ?? '—'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{cert.course_name ?? cert.file_name ?? '—'}</TableCell>
                      <TableCell>{cert.completion_date ? format(new Date(cert.completion_date), 'dd/MM/yyyy') : '—'}</TableCell>
                      <TableCell>{expiryBadge(cert.expiry_date)}</TableCell>
                      <TableCell>{cert.hours ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={cfg.variant} className="flex items-center gap-1 w-fit">
                          {cfg.icon}{cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          disabled={isDeleting}
                          onClick={(e) => handleDeleteCert(cert, e)}
                          title="Excluir certificado"
                        >
                          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Página {page + 1} de {totalPages} ({total} registros)</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail sheet */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.employee_name ?? 'Certificado'}</SheetTitle>
                <SheetDescription>{selected.course_name ?? selected.file_name ?? '—'}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <DetailRow label="Colaborador" value={selected.employee_name} />
                <DetailRow label="Curso / Documento" value={selected.course_name} />
                <DetailRow label="Arquivo" value={selected.file_name} />
                <DetailRow label="Conclusão" value={selected.completion_date ? format(new Date(selected.completion_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : null} />
                <DetailRow label="Vencimento" value={selected.expiry_date ? format(new Date(selected.expiry_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : null} />
                <DetailRow label="Carga horária" value={selected.hours ? `${selected.hours}h` : null} />
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge variant={CERT_STATUS[selected.status ?? '']?.variant ?? 'outline'}>
                    {CERT_STATUS[selected.status ?? '']?.label ?? selected.status ?? '—'}
                  </Badge>
                </div>
                {selected.rejection_reason && (
                  <div className="p-3 rounded-md bg-destructive/10 text-sm text-destructive">
                    <strong>Motivo da rejeição:</strong> {selected.rejection_reason}
                  </div>
                )}
                {selected.file_url && (
                  <Button variant="outline" className="w-full" asChild>
                    <a href={selected.file_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />Abrir arquivo
                    </a>
                  </Button>
                )}
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={deletingId === selected.id}
                  onClick={(e) => handleDeleteCert(selected, e)}
                >
                  {deletingId === selected.id
                    ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    : <Trash2 className="h-4 w-4 mr-2" />}
                  Excluir certificado
                </Button>
                {selected.created_at && (
                  <p className="text-xs text-muted-foreground text-center">
                    Processado em {format(new Date(selected.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── RAG Documents Tab ───────────────────────────────────────────────────────

interface GroupedRagDoc {
  source_name: string;
  file_name: string | null;
  status: string | null;
  source: string | null;
  created_at: string | null;
  chunk_count: number;
  ids: number[];
}

function RagTab() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<GroupedRagDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingSource, setDeletingSource] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchDocs(); }, [search]);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_rag_documents');
      if (error) throw error;
      const all = (data as GroupedRagDoc[]) ?? [];
      const filtered = search.trim()
        ? all.filter(d => d.source_name.toLowerCase().includes(search.toLowerCase()))
        : all;
      setDocs(filtered);
      setTotal(filtered.length);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (doc: GroupedRagDoc) => {
    if (!confirm(`Excluir "${doc.source_name}" e todos os seus ${doc.chunk_count} chunks? Esta ação não pode ser desfeita.`)) return;
    setDeletingSource(doc.source_name);
    try {
      const { error } = await supabase.from('documents').delete().in('id', doc.ids);
      if (error) throw error;
      toast.success('Documento excluído com sucesso.');
      if (user) await logActivity(user.id, 'rag_document_deleted', { file_name: doc.source_name });
      await fetchDocs();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao excluir documento.');
    } finally {
      setDeletingSource(null);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.type !== 'application/pdf') {
      toast.error('Apenas arquivos PDF são aceitos para documentos RAG.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 20MB.');
      return;
    }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const apiUrl = import.meta.env.VITE_API_URL;

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${apiUrl}/api/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || 'Erro ao enviar documento.');
        return;
      }

      toast.success('Documento enviado! Será processado em background.');
      await logActivity(user.id, 'rag_document_uploaded', { file_name: file.name });
      await fetchDocs();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao enviar documento.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome do arquivo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="icon" onClick={fetchDocs} disabled={loading} title="Atualizar lista">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2 shrink-0">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? 'Enviando...' : 'Enviar PDF'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Apenas PDF • Máximo 20MB • O documento será processado e indexado para o Assistente IA • {total} documento{total !== 1 ? 's' : ''} indexado{total !== 1 ? 's' : ''}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Chunks</TableHead>
                <TableHead>Enviado em</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : docs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-16 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    Nenhum documento RAG encontrado.<br />
                    <span className="text-xs">Envie um PDF para que o Assistente IA possa usá-lo como referência.</span>
                  </TableCell>
                </TableRow>
              ) : (
                docs.map((doc) => {
                  const cfg = RAG_STATUS[doc.status ?? 'active'] ?? { label: 'Ativo', variant: 'default' as const };
                  const isDeleting = deletingSource === doc.source_name;
                  return (
                    <TableRow key={doc.source_name}>
                      <TableCell className="font-medium max-w-[300px]">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate">{doc.source_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{doc.chunk_count} chunk{doc.chunk_count !== 1 ? 's' : ''}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {doc.created_at ? format(new Date(doc.created_at), 'dd/MM/yyyy HH:mm') : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={cfg.variant}>{cfg.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(doc)}
                          disabled={isDeleting}
                          title="Excluir documento e todos os chunks"
                        >
                          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between py-2 border-b">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value ?? '—'}</span>
    </div>
  );
}
