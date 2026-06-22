import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from '@/components/AppSidebar';
import { MobileNavTrigger } from '@/components/MobileNavTrigger';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
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
  Sparkles,
  Plus,
  Pencil,
  Save,
  X as XIcon,
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
  validade_meses: number | null;
  conteudo_programatico: string | null;
  nr_codes: string[] | null;
  file_name: string | null;
  file_url: string | null;
  status: string | null;
  rejection_reason: string | null;
  source?: string | null;
  renewed_at?: string | null;
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
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar, schedulePendingCollapse } = useSidebarCollapsed();
  const [searchParams] = useSearchParams();
  const initialExpiryFilter = searchParams.get('expiry') ?? 'all';

  useEffect(() => {
    if (authLoading) return;
    if (!user) navigate('/login');
  }, [user, authLoading]);

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} onCollapse={schedulePendingCollapse} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b bg-card flex items-center justify-between px-4 md:px-6 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <MobileNavTrigger />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">Documentos</h1>
              <p className="text-xs text-muted-foreground truncate">Gerencie certificados e documentos RAG</p>
            </div>
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
              <CertificatesTab initialExpiryFilter={initialExpiryFilter} />
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

function CertificatesTab({ initialExpiryFilter = 'all' }: { initialExpiryFilter?: string }) {
  const { user } = useAuth();
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expiryFilter, setExpiryFilter] = useState(initialExpiryFilter);
  const [selected, setSelected] = useState<Certificate | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [expiredDialogCert, setExpiredDialogCert] = useState<Certificate | null>(null);
  // Set of cert IDs currently being watched (shows "Extraindo..." in UI)
  const [watchingIds, setWatchingIds] = useState<Set<string>>(new Set());
  // Manual-entry dialog state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualForm, setManualForm] = useState({
    employee_name: '',
    course_name: '',
    completion_date: '',
    expiry_date: '',
    hours: '',
    validade_meses: '',
    nr_codes: '',
    conteudo_programatico: '',
    file_name: '',
    file_url: '',
  });
  // Detail-panel edit state
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    employee_name: '',
    course_name: '',
    completion_date: '',
    expiry_date: '',
    hours: '',
    validade_meses: '',
    nr_codes: '',
    conteudo_programatico: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manualFileInputRef = useRef<HTMLInputElement>(null);
  // Map of certId → timeout handle for active watchers
  const watchersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => { setPage(0); }, [search, statusFilter, expiryFilter]);
  useEffect(() => { fetchCerts(); }, [page, search, statusFilter, expiryFilter]);

  // Cleanup all watchers on unmount
  useEffect(() => {
    return () => {
      watchersRef.current.forEach(t => clearTimeout(t));
      watchersRef.current.clear();
    };
  }, []);

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

  const isExpiredByDate = (dateStr: string | null) =>
    !!dateStr && new Date(dateStr) < new Date();

  // Watch a specific cert until it reaches a terminal status.
  // Uses recursive setTimeout to avoid stale closure / setInterval cleanup bugs.
  const watchCert = (certId: string, attempts = 0) => {
    const MAX_ATTEMPTS = 36; // 36 × 5s = 3 min max
    if (attempts >= MAX_ATTEMPTS) {
      watchersRef.current.delete(certId);
      setWatchingIds(prev => { const s = new Set(prev); s.delete(certId); return s; });
      return;
    }

    const timeout = setTimeout(async () => {
      watchersRef.current.delete(certId);

      const { data } = await supabase
        .from('processed_certificates')
        .select('*')
        .eq('id', certId)
        .maybeSingle();

      if (!data) {
        // Check if this cert was merged into an existing one (renewal)
        const { data: renewedCert } = await supabase
          .from('processed_certificates')
          .select('id, employee_name, course_name, status')
          .eq('renewed_from', certId)
          .maybeSingle();

        setWatchingIds(prev => { const s = new Set(prev); s.delete(certId); return s; });

        if (renewedCert) {
          toast.success(`Certificado atualizado: ${renewedCert.employee_name ?? '—'} — ${renewedCert.course_name ?? '—'}`);
          fetchCerts();
          return;
        }

        // Cert was truly deleted — show popup
        setExpiredDialogCert({
          id: certId, status: 'expired', expiry_date: null,
          employee_name: null, course_name: null, completion_date: null,
          hours: null, file_name: null, file_url: null,
          rejection_reason: null, created_at: null,
          validade_meses: null, conteudo_programatico: null, nr_codes: null,
        });
        fetchCerts();
        return;
      }

      // Worker flow: insert('pending') → 'processing' → update with data + 'pending'
      //   (trigger converts to 'expired' if expiry_date < today)
      // Keep waiting only if status is 'processing' OR status is 'pending' but
      // no data has been filled in yet (worker hasn't touched the row).
      const hasData = data.employee_name != null || data.course_name != null || data.expiry_date != null;
      if (data.status === 'processing' || (data.status === 'pending' && !hasData)) {
        watchCert(certId, attempts + 1);
        return;
      }

      // Terminal status reached — remove from watching set and refresh list
      setWatchingIds(prev => { const s = new Set(prev); s.delete(certId); return s; });
      fetchCerts();

      // Show popup if DB says expired/rejected/error, OR if expiry_date is in the past
      // (client-side fallback in case trigger didn't fire)
      if (
        data.status === 'expired' ||
        data.status === 'rejected' ||
        data.status === 'error' ||
        isExpiredByDate(data.expiry_date)
      ) {
        const effectiveStatus = data.status === 'error' ? 'error' : 'expired';
        setExpiredDialogCert({ ...data, status: effectiveStatus } as Certificate);
      }
    }, 5000);

    watchersRef.current.set(certId, timeout);
  };

  const startWatching = (certId: string) => {
    setWatchingIds(prev => new Set(prev).add(certId));
    watchCert(certId);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !user) return;

    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    const validFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (!validTypes.includes(file.type)) {
        toast.error(`Formato inválido: ${file.name}. Use PDF, JPEG ou PNG.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`Arquivo muito grande: ${file.name}. Máximo 10MB.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: validFiles.length });

    const { data: { session } } = await supabase.auth.getSession();
    const apiUrl = import.meta.env.VITE_API_URL;
    let successCount = 0;

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      setUploadProgress({ current: i + 1, total: validFiles.length });
      try {
        const ext = file.name.split('.').pop();
        const path = `${user.id}/${Date.now()}_${i}.${ext}`;

        const { error: uploadError } = await supabase.storage.from('certificates').upload(path, file);
        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage.from('certificates').getPublicUrl(path);

        const { data: certRow, error: dbError } = await supabase
          .from('processed_certificates')
          .insert({ file_name: file.name, file_url: publicUrl, status: 'pending', org_id: null })
          .select('id')
          .single();
        if (dbError) throw dbError;

        const res = await fetch(`${apiUrl}/api/certificates/${certRow.id}/extract`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ file_url: publicUrl, file_name: file.name }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error('Extract endpoint failed', { status: res.status, body: errText });
          toast.error(`Falha na extração de ${file.name} (HTTP ${res.status})`);
        } else {
          startWatching(certRow.id);
          successCount++;
        }

        await logActivity(user.id, 'certificate_uploaded', { file_name: file.name });
      } catch (err: unknown) {
        console.error(err);
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Erro ao enviar ${file.name}: ${msg}`);
      }
    }

    if (successCount > 0) {
      toast.success(
        validFiles.length === 1
          ? 'Certificado enviado! Extraindo dados automaticamente...'
          : `${successCount} certificado${successCount > 1 ? 's' : ''} enviado${successCount > 1 ? 's' : ''}! Extraindo dados...`
      );
    }
    await fetchCerts();
    setUploading(false);
    setUploadProgress({ current: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExtract = async (cert: Certificate, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!cert.file_url || !cert.file_name) {
      toast.error('Certificado sem URL de arquivo. Reenvie o certificado.');
      return;
    }
    setExtractingId(cert.id);
    // Optimistically update status in UI
    setCerts(prev => prev.map(c => c.id === cert.id ? { ...c, status: 'processing' } : c));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const apiUrl = import.meta.env.VITE_API_URL;
      const res = await fetch(`${apiUrl}/api/certificates/${cert.id}/extract`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_url: cert.file_url, file_name: cert.file_name }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao disparar extração');
      // Start watching this cert for terminal status
      startWatching(cert.id);
      toast.success('Extração iniciada! Os dados serão preenchidos automaticamente.');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao iniciar extração.');
      setCerts(prev => prev.map(c => c.id === cert.id ? { ...c, status: 'pending' } : c));
    } finally {
      setExtractingId(null);
    }
  };

  const resetManualForm = () => {
    setManualForm({
      employee_name: '',
      course_name: '',
      completion_date: '',
      expiry_date: '',
      hours: '',
      validade_meses: '',
      nr_codes: '',
      conteudo_programatico: '',
      file_name: '',
      file_url: '',
    });
  };

  const handleManualFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('certificates').upload(path, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('certificates').getPublicUrl(path);
      setManualForm(prev => ({ ...prev, file_name: file.name, file_url: publicUrl }));
      toast.success('Arquivo anexado.');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao anexar arquivo.');
    } finally {
      if (manualFileInputRef.current) manualFileInputRef.current.value = '';
    }
  };

  const handleManualSave = async () => {
    if (!user) return;
    if (
      !manualForm.employee_name.trim() ||
      !manualForm.course_name.trim() ||
      !manualForm.completion_date ||
      !manualForm.hours
    ) {
      toast.error('Colaborador, curso, data de conclusão e carga horária são obrigatórios.');
      return;
    }

    setManualSaving(true);
    try {
      // Regras de validade (mesma lógica do worker):
      // se nem expiry nem validade vierem, assume 12 meses.
      let validadeMeses = manualForm.validade_meses ? parseInt(manualForm.validade_meses, 10) : null;
      let expiryDate = manualForm.expiry_date || null;
      const completionDate = manualForm.completion_date;
      if (validadeMeses == null && !expiryDate) validadeMeses = 12;
      if (!expiryDate && completionDate && validadeMeses) {
        const d = new Date(completionDate + 'T00:00:00Z');
        d.setUTCMonth(d.getUTCMonth() + validadeMeses);
        expiryDate = d.toISOString().slice(0, 10);
      }
      if (validadeMeses == null && expiryDate && completionDate) {
        const start = new Date(completionDate + 'T00:00:00Z');
        const end = new Date(expiryDate + 'T00:00:00Z');
        const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
        if (months > 0) validadeMeses = months;
      }

      const nrCodes = manualForm.nr_codes
        .split(/[,;\s]+/)
        .map(s => s.trim().toUpperCase().replace(/^NR\s*-?\s*/i, 'NR-'))
        .filter(s => /^NR-\d+$/.test(s));

      const { error } = await supabase.from('processed_certificates').insert({
        employee_name: manualForm.employee_name.trim(),
        course_name: manualForm.course_name.trim(),
        completion_date: completionDate || null,
        expiry_date: expiryDate,
        hours: manualForm.hours ? Number(manualForm.hours) : null,
        validade_meses: validadeMeses,
        nr_codes: nrCodes.length > 0 ? nrCodes : null,
        conteudo_programatico: manualForm.conteudo_programatico.trim() || null,
        file_name: manualForm.file_name || null,
        file_url: manualForm.file_url || null,
        status: 'approved', // manually entered by admin — trigger will convert to 'expired' if past date
        source: 'manual',
        org_id: null,
      });
      if (error) throw error;
      toast.success('Certificado adicionado manualmente.');
      await logActivity(user.id, 'certificate_uploaded', { file_name: manualForm.file_name || manualForm.course_name });
      setManualOpen(false);
      resetManualForm();
      await fetchCerts();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao salvar: ${msg}`);
    } finally {
      setManualSaving(false);
    }
  };

  const startEdit = (cert: Certificate) => {
    setEditForm({
      employee_name: cert.employee_name ?? '',
      course_name: cert.course_name ?? '',
      completion_date: cert.completion_date ?? '',
      expiry_date: cert.expiry_date ?? '',
      hours: cert.hours != null ? String(cert.hours) : '',
      validade_meses: cert.validade_meses != null ? String(cert.validade_meses) : '',
      nr_codes: (cert.nr_codes ?? []).join(', '),
      conteudo_programatico: cert.conteudo_programatico ?? '',
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const handleEditSave = async () => {
    if (!selected || !user) return;
    if (!editForm.employee_name.trim() || !editForm.course_name.trim() || !editForm.completion_date) {
      toast.error('Colaborador, curso e data de conclusão são obrigatórios.');
      return;
    }

    setSavingEdit(true);
    try {
      // Aplicar mesmas regras de validade do manual save / worker
      let validadeMeses = editForm.validade_meses ? parseInt(editForm.validade_meses, 10) : null;
      let expiryDate = editForm.expiry_date || null;
      const completionDate = editForm.completion_date;
      if (validadeMeses == null && !expiryDate) validadeMeses = 12;
      if (!expiryDate && completionDate && validadeMeses) {
        const d = new Date(completionDate + 'T00:00:00Z');
        d.setUTCMonth(d.getUTCMonth() + validadeMeses);
        expiryDate = d.toISOString().slice(0, 10);
      }
      if (validadeMeses == null && expiryDate && completionDate) {
        const start = new Date(completionDate + 'T00:00:00Z');
        const end = new Date(expiryDate + 'T00:00:00Z');
        const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
        if (months > 0) validadeMeses = months;
      }

      const nrCodes = editForm.nr_codes
        .split(/[,;\s]+/)
        .map(s => s.trim().toUpperCase().replace(/^NR\s*-?\s*/i, 'NR-'))
        .filter(s => /^NR-\d+$/.test(s));

      const updates = {
        employee_name: editForm.employee_name.trim(),
        course_name: editForm.course_name.trim(),
        completion_date: completionDate || null,
        expiry_date: expiryDate,
        hours: editForm.hours ? Number(editForm.hours) : null,
        validade_meses: validadeMeses,
        nr_codes: nrCodes.length > 0 ? nrCodes : null,
        conteudo_programatico: editForm.conteudo_programatico.trim() || null,
      };

      const { error } = await supabase
        .from('processed_certificates')
        .update(updates)
        .eq('id', selected.id);
      if (error) throw error;

      // Refletir localmente sem precisar de refetch full
      const updatedCert: Certificate = { ...selected, ...updates };
      setSelected(updatedCert);
      setCerts(prev => prev.map(c => (c.id === selected.id ? updatedCert : c)));
      toast.success('Certificado atualizado.');
      setEditing(false);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao salvar: ${msg}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteCert = async (cert: Certificate, e?: React.MouseEvent, skipConfirm = false) => {
    e?.stopPropagation(); // prevent opening the detail sheet
    if (!skipConfirm && !confirm(`Excluir o certificado "${cert.file_name ?? cert.course_name}"? Esta ação não pode ser desfeita.`)) return;
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
          <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-3">
            <div className="relative w-full md:flex-1 md:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por colaborador, curso ou arquivo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="approved">Aprovado</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="processing">Processando</SelectItem>
                <SelectItem value="expired">Vencido</SelectItem>
                <SelectItem value="rejected">Rejeitado</SelectItem>
                <SelectItem value="error">Erro</SelectItem>
              </SelectContent>
            </Select>
            <Select value={expiryFilter} onValueChange={setExpiryFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Vencimento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os vencimentos</SelectItem>
                <SelectItem value="expiring30">Vencendo em 30 dias</SelectItem>
                <SelectItem value="expired">Vencidos</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2 w-full md:w-auto md:shrink-0">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading
                ? (uploadProgress.total > 1 ? `Enviando ${uploadProgress.current}/${uploadProgress.total}...` : 'Enviando...')
                : 'Enviar Certificados'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setManualOpen(true)}
              className="gap-2 w-full md:w-auto md:shrink-0"
            >
              <Plus className="h-4 w-4" />
              Adicionar manualmente
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              multiple
              className="hidden"
              onChange={handleUpload}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Formatos aceitos: PDF, JPEG, PNG • Máximo 10MB • {total} certificado{total !== 1 ? 's' : ''} no sistema
          </p>
        </CardContent>
      </Card>

      {/* Table — desktop */}
      <Card className="hidden md:block">
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
                  const isWatching = watchingIds.has(cert.id);
                  const effectiveStatus = isWatching ? 'processing' : (cert.status ?? '');
                  const cfg = CERT_STATUS[effectiveStatus] ?? { label: effectiveStatus || '—', variant: 'outline' as const, icon: null };
                  const isDeleting = deletingId === cert.id;
                  const isExtracting = extractingId === cert.id;
                  const canExtract = !isWatching && (cert.status === 'pending' || cert.status === 'error') && !!cert.file_url;
                  return (
                    <TableRow key={cert.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(cert)}>
                      <TableCell className="font-medium">{cert.employee_name ?? '—'}</TableCell>
                      <TableCell className="max-w-[260px]">
                        <div className="flex flex-col gap-1">
                          <span className="truncate">{cert.course_name ?? cert.file_name ?? '—'}</span>
                          {cert.nr_codes && cert.nr_codes.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {cert.nr_codes.map(nr => (
                                <Badge key={nr} variant="outline" className="text-[10px] py-0 h-4 border-amber-500/50 text-amber-600 dark:text-amber-400">
                                  {nr}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{cert.completion_date ? format(new Date(cert.completion_date), 'dd/MM/yyyy') : '—'}</TableCell>
                      <TableCell>{expiryBadge(cert.expiry_date)}</TableCell>
                      <TableCell>{cert.hours ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={cfg.variant} className="flex items-center gap-1 w-fit">
                            {cfg.icon}{cfg.label}
                          </Badge>
                          {cert.source === 'manual' && (
                            <Badge variant="outline" className="text-xs w-fit text-blue-500 border-blue-500/50">
                              Manual
                            </Badge>
                          )}
                          {cert.renewed_at && (
                            <span className="text-xs text-muted-foreground">
                              Atualizado em {format(new Date(cert.renewed_at), 'dd/MM/yyyy')}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {canExtract && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
                              disabled={isExtracting}
                              onClick={(e) => handleExtract(cert, e)}
                              title="Extrair dados com IA"
                            >
                              {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            </Button>
                          )}
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
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cards — mobile */}
      <div className="md:hidden space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))
        ) : certs.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12 text-muted-foreground">
              <FileCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
              Nenhum certificado encontrado.
            </CardContent>
          </Card>
        ) : (
          certs.map((cert) => {
            const isWatching = watchingIds.has(cert.id);
            const effectiveStatus = isWatching ? 'processing' : (cert.status ?? '');
            const cfg = CERT_STATUS[effectiveStatus] ?? { label: effectiveStatus || '—', variant: 'outline' as const, icon: null };
            const isDeleting = deletingId === cert.id;
            const isExtracting = extractingId === cert.id;
            const canExtract = !isWatching && (cert.status === 'pending' || cert.status === 'error') && !!cert.file_url;
            return (
              <Card key={cert.id} className="cursor-pointer hover:bg-muted/40 active:bg-muted/60" onClick={() => setSelected(cert)}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{cert.employee_name ?? '—'}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {cert.course_name ?? cert.file_name ?? '—'}
                      </p>
                    </div>
                    <Badge variant={cfg.variant} className="flex items-center gap-1 shrink-0">
                      {cfg.icon}{cfg.label}
                    </Badge>
                  </div>

                  {cert.nr_codes && cert.nr_codes.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {cert.nr_codes.map(nr => (
                        <Badge key={nr} variant="outline" className="text-[10px] py-0 h-4 border-amber-500/50 text-amber-600 dark:text-amber-400">
                          {nr}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Conclusão</p>
                      <p>{cert.completion_date ? format(new Date(cert.completion_date), 'dd/MM/yyyy') : '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Vencimento</p>
                      <div>{expiryBadge(cert.expiry_date) ?? <span>—</span>}</div>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Carga</p>
                      <p>{cert.hours ? `${cert.hours}h` : '—'}</p>
                    </div>
                  </div>

                  {(cert.source === 'manual' || cert.renewed_at) && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {cert.source === 'manual' && (
                        <Badge variant="outline" className="text-blue-500 border-blue-500/50">Manual</Badge>
                      )}
                      {cert.renewed_at && (
                        <span className="text-muted-foreground">
                          Atualizado em {format(new Date(cert.renewed_at), 'dd/MM/yyyy')}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2 border-t">
                    {canExtract && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
                        disabled={isExtracting}
                        onClick={(e) => handleExtract(cert, e)}
                      >
                        {isExtracting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                        Extrair
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={isDeleting}
                      onClick={(e) => handleDeleteCert(cert, e)}
                    >
                      {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                      Excluir
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

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

      {/* Expired / error certificate dialog */}
      <AlertDialog open={!!expiredDialogCert} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              {expiredDialogCert?.status === 'error'
                ? 'Falha ao extrair dados'
                : 'Certificado rejeitado'}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-1">
              {expiredDialogCert?.status === 'error' ? (
                <>
                  <span className="block">
                    {expiredDialogCert.rejection_reason ??
                      'Não foi possível extrair os dados deste certificado automaticamente.'}
                  </span>
                  <span className="block font-medium text-foreground">
                    Verifique se o arquivo está legível e tente novamente.
                  </span>
                </>
              ) : (
                <>
                  <span className="block">
                    {expiredDialogCert?.expiry_date
                      ? `Este certificado venceu em ${format(new Date(expiredDialogCert.expiry_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })} e foi rejeitado pelo sistema.`
                      : 'Este certificado está vencido e foi rejeitado pelo sistema.'}
                  </span>
                  <span className="block font-medium text-foreground">
                    Ele não será salvo no banco de dados.
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={async () => {
                if (expiredDialogCert) {
                  await handleDeleteCert(expiredDialogCert, undefined, true);
                  setExpiredDialogCert(null);
                }
              }}
            >
              Entendido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manual entry dialog */}
      <Dialog
        open={manualOpen}
        onOpenChange={(open) => {
          setManualOpen(open);
          if (!open) resetManualForm();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar certificado manualmente</DialogTitle>
            <DialogDescription>
              Colaborador, curso, conclusão e carga horária são obrigatórios. Vencimento é opcional — se não for preenchido, será calculado a partir da validade (padrão 1 ano).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="manual-employee">Colaborador</Label>
              <Input
                id="manual-employee"
                value={manualForm.employee_name}
                onChange={(e) => setManualForm(prev => ({ ...prev, employee_name: e.target.value }))}
                placeholder="Nome completo"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-course">Curso / Treinamento</Label>
              <Input
                id="manual-course"
                value={manualForm.course_name}
                onChange={(e) => setManualForm(prev => ({ ...prev, course_name: e.target.value }))}
                placeholder="Ex: NR-10 - Segurança em eletricidade"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-nr-codes">Normas (NR) — opcional</Label>
              <Input
                id="manual-nr-codes"
                value={manualForm.nr_codes}
                onChange={(e) => setManualForm(prev => ({ ...prev, nr_codes: e.target.value }))}
                placeholder="Ex: NR-6, NR-33"
              />
              <p className="text-[11px] text-muted-foreground">Separe por vírgula ou espaço. Use o formato NR-NN.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="manual-completion">Data de conclusão</Label>
                <Input
                  id="manual-completion"
                  type="date"
                  value={manualForm.completion_date}
                  onChange={(e) => setManualForm(prev => ({ ...prev, completion_date: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="manual-expiry">Vencimento (opcional)</Label>
                <Input
                  id="manual-expiry"
                  type="date"
                  value={manualForm.expiry_date}
                  onChange={(e) => setManualForm(prev => ({ ...prev, expiry_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="manual-hours">Carga horária (horas)</Label>
                <Input
                  id="manual-hours"
                  type="number"
                  min="1"
                  value={manualForm.hours}
                  onChange={(e) => setManualForm(prev => ({ ...prev, hours: e.target.value }))}
                  placeholder="40"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="manual-validade">Validade (meses) — opcional</Label>
                <Input
                  id="manual-validade"
                  type="number"
                  min="1"
                  value={manualForm.validade_meses}
                  onChange={(e) => setManualForm(prev => ({ ...prev, validade_meses: e.target.value }))}
                  placeholder="12"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-conteudo">Conteúdo programático — opcional</Label>
              <textarea
                id="manual-conteudo"
                value={manualForm.conteudo_programatico}
                onChange={(e) => setManualForm(prev => ({ ...prev, conteudo_programatico: e.target.value }))}
                placeholder="Tópicos abordados, ementa do treinamento..."
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
              />
            </div>
            <div className="space-y-1">
              <Label>Arquivo (opcional)</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => manualFileInputRef.current?.click()}
                  className="gap-2"
                >
                  <Upload className="h-3 w-3" />
                  {manualForm.file_name ? 'Trocar arquivo' : 'Anexar arquivo'}
                </Button>
                {manualForm.file_name && (
                  <span className="text-xs text-muted-foreground truncate">
                    {manualForm.file_name}
                  </span>
                )}
              </div>
              <input
                ref={manualFileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleManualFileSelect}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setManualOpen(false);
                resetManualForm();
              }}
              disabled={manualSaving}
            >
              Cancelar
            </Button>
            <Button onClick={handleManualSave} disabled={manualSaving}>
              {manualSaving ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Salvando...</>
              ) : (
                'Salvar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail sheet */}
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setEditing(false);
          }
        }}
      >
        <SheetContent className="w-[90vw] sm:w-[540px] sm:max-w-[540px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.employee_name ?? 'Certificado'}</SheetTitle>
                <SheetDescription>{selected.course_name ?? selected.file_name ?? '—'}</SheetDescription>
              </SheetHeader>

              {editing ? (
                <div className="mt-6 space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="edit-employee">Colaborador</Label>
                    <Input
                      id="edit-employee"
                      value={editForm.employee_name}
                      onChange={(e) => setEditForm(prev => ({ ...prev, employee_name: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-course">Curso / Treinamento</Label>
                    <Input
                      id="edit-course"
                      value={editForm.course_name}
                      onChange={(e) => setEditForm(prev => ({ ...prev, course_name: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-nr">Normas (NR)</Label>
                    <Input
                      id="edit-nr"
                      value={editForm.nr_codes}
                      onChange={(e) => setEditForm(prev => ({ ...prev, nr_codes: e.target.value }))}
                      placeholder="Ex: NR-6, NR-33"
                    />
                    <p className="text-[11px] text-muted-foreground">Separe por vírgula ou espaço.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="edit-completion">Conclusão</Label>
                      <Input
                        id="edit-completion"
                        type="date"
                        value={editForm.completion_date}
                        onChange={(e) => setEditForm(prev => ({ ...prev, completion_date: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-expiry">Vencimento</Label>
                      <Input
                        id="edit-expiry"
                        type="date"
                        value={editForm.expiry_date}
                        onChange={(e) => setEditForm(prev => ({ ...prev, expiry_date: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="edit-hours">Carga horária</Label>
                      <Input
                        id="edit-hours"
                        type="number"
                        min="1"
                        value={editForm.hours}
                        onChange={(e) => setEditForm(prev => ({ ...prev, hours: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-validade">Validade (meses)</Label>
                      <Input
                        id="edit-validade"
                        type="number"
                        min="1"
                        value={editForm.validade_meses}
                        onChange={(e) => setEditForm(prev => ({ ...prev, validade_meses: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-conteudo">Conteúdo programático</Label>
                    <textarea
                      id="edit-conteudo"
                      value={editForm.conteudo_programatico}
                      onChange={(e) => setEditForm(prev => ({ ...prev, conteudo_programatico: e.target.value }))}
                      placeholder="Tópicos abordados, ementa..."
                      rows={6}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={cancelEdit}
                      disabled={savingEdit}
                    >
                      <XIcon className="h-4 w-4 mr-2" />
                      Cancelar
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleEditSave}
                      disabled={savingEdit}
                    >
                      {savingEdit
                        ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        : <Save className="h-4 w-4 mr-2" />}
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => startEdit(selected)}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Editar informações
                  </Button>
                  <DetailRow label="Colaborador" value={selected.employee_name} />
                  <DetailRow label="Curso / Documento" value={selected.course_name} />
                  {selected.nr_codes && selected.nr_codes.length > 0 && (
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Treinamento (NR)</span>
                      <div className="flex flex-wrap gap-1 justify-end">
                        {selected.nr_codes.map(nr => (
                          <Badge key={nr} variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                            {nr}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <DetailRow label="Arquivo" value={selected.file_name} />
                  <DetailRow label="Conclusão" value={selected.completion_date ? format(new Date(selected.completion_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : null} />
                  <DetailRow label="Vencimento" value={selected.expiry_date ? format(new Date(selected.expiry_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : null} />
                  <DetailRow label="Validade" value={selected.validade_meses ? formatValidade(selected.validade_meses) : null} />
                  <DetailRow label="Carga horária" value={selected.hours ? `${selected.hours}h` : null} />
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={CERT_STATUS[selected.status ?? '']?.variant ?? 'outline'}>
                        {CERT_STATUS[selected.status ?? '']?.label ?? selected.status ?? '—'}
                      </Badge>
                      {selected.source === 'manual' && (
                        <Badge variant="outline" className="text-blue-500 border-blue-500/50">
                          Manual
                        </Badge>
                      )}
                      {selected.renewed_at && (
                        <span className="text-xs text-muted-foreground">
                          Atualizado em {format(new Date(selected.renewed_at), 'dd/MM/yyyy')}
                        </span>
                      )}
                    </div>
                  </div>
                  {selected.rejection_reason && (
                    <div className="p-3 rounded-md bg-destructive/10 text-sm text-destructive">
                      <strong>Motivo da rejeição:</strong> {selected.rejection_reason}
                    </div>
                  )}
                  {selected.conteudo_programatico && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">Conteúdo programático</h4>
                      <div className="p-3 rounded-md bg-muted/40 border text-sm whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                        {selected.conteudo_programatico}
                      </div>
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
                    onClick={(e) => handleDeleteCert(selected, e, false)}
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
              )}
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
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchDocs(); }, [search]);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('list_rag_documents');
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
      const apiUrl = import.meta.env.VITE_API_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${apiUrl}/api/rag-documents/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ ids: doc.ids, source_name: doc.source_name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success('Documento excluído com sucesso.');
      if (user) await logActivity(user.id, 'rag_document_deleted', { file_name: doc.source_name });
      await fetchDocs();
    } catch (err) {
      console.error('RAG delete error:', err);
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      toast.error(`Erro ao excluir documento: ${msg}`);
    } finally {
      setDeletingSource(null);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0 || !user) return;

    const validFiles = files.filter(f => {
      if (f.type !== 'application/pdf') {
        toast.error(`"${f.name}" ignorado: apenas PDF é aceito.`);
        return false;
      }
      if (f.size > 20 * 1024 * 1024) {
        toast.error(`"${f.name}" ignorado: maior que 20MB.`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    setUploadProgress({ current: 0, total: validFiles.length });

    const { data: { session } } = await supabase.auth.getSession();
    const apiUrl = import.meta.env.VITE_API_URL;
    let successCount = 0;

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      setUploadProgress({ current: i + 1, total: validFiles.length });
      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${apiUrl}/api/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}` },
          body: formData,
        });

        const result = await response.json();

        if (!response.ok) {
          toast.error(`"${file.name}": ${result.error || 'erro ao enviar'}`);
          continue;
        }

        await logActivity(user.id, 'rag_document_uploaded', { file_name: file.name });
        successCount++;
      } catch (err) {
        console.error(err);
        toast.error(`Erro ao enviar "${file.name}".`);
      }
    }

    if (successCount > 0) {
      toast.success(
        successCount === 1
          ? 'Documento enviado! Será processado em background.'
          : `${successCount} documentos enviados! Serão processados em background.`
      );
      await fetchDocs();
    }

    setUploading(false);
    setUploadProgress({ current: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-3">
            <div className="relative w-full md:flex-1 md:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome do arquivo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={fetchDocs} disabled={loading} title="Atualizar lista" className="shrink-0">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2 flex-1 md:flex-initial md:shrink-0">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading
                  ? uploadProgress.total > 1
                    ? `Enviando ${uploadProgress.current}/${uploadProgress.total}...`
                    : 'Enviando...'
                  : 'Enviar PDF'}
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={handleUpload}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Apenas PDF • Máximo 20MB • O documento será processado e indexado para o Assistente IA • {total} documento{total !== 1 ? 's' : ''} indexado{total !== 1 ? 's' : ''}
          </p>
        </CardContent>
      </Card>

      {/* Desktop */}
      <Card className="hidden md:block">
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

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : docs.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              Nenhum documento RAG encontrado.
            </CardContent>
          </Card>
        ) : (
          docs.map((doc) => {
            const cfg = RAG_STATUS[doc.status ?? 'active'] ?? { label: 'Ativo', variant: 'default' as const };
            const isDeleting = deletingSource === doc.source_name;
            return (
              <Card key={doc.source_name}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <span className="text-sm font-medium break-all">{doc.source_name}</span>
                    </div>
                    <Badge variant={cfg.variant} className="shrink-0">{cfg.label}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                    <span>
                      {doc.chunk_count} chunk{doc.chunk_count !== 1 ? 's' : ''}
                      {doc.created_at && ` • ${format(new Date(doc.created_at), 'dd/MM/yyyy')}`}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8"
                      onClick={() => handleDelete(doc)}
                      disabled={isDeleting}
                    >
                      {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
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

function formatValidade(meses: number): string {
  if (meses % 12 === 0) {
    const anos = meses / 12;
    return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  }
  return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
}
