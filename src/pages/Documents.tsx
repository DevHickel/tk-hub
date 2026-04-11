import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
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
import { ThemeToggle } from '@/components/ThemeToggle';
import { AppSidebar } from '@/components/AppSidebar';
import {
  FileText,
  Search,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
  org_id: string | null;
  raw_data: Record<string, unknown> | null;
  rejection_reason: string | null;
  created_at: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
  approved: {
    label: 'Aprovado',
    variant: 'default',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  pending: {
    label: 'Pendente',
    variant: 'secondary',
    icon: <Clock className="h-3 w-3" />,
  },
  rejected: {
    label: 'Rejeitado',
    variant: 'destructive',
    icon: <XCircle className="h-3 w-3" />,
  },
  expired: {
    label: 'Vencido',
    variant: 'outline',
    icon: <AlertTriangle className="h-3 w-3" />,
  },
};

const PAGE_SIZE = 20;

export default function Documents() {
  const { user, profile, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [certs, setCerts] = useState<Certificate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expiryFilter, setExpiryFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Certificate | null>(null);

  useEffect(() => {
    if (!user) navigate('/login');
  }, [user]);

  useEffect(() => {
    setPage(0);
  }, [search, statusFilter, expiryFilter]);

  useEffect(() => {
    fetchCerts();
  }, [page, search, statusFilter, expiryFilter]);

  const fetchCerts = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('processed_certificates')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search.trim()) {
        query = query.or(
          `employee_name.ilike.%${search}%,course_name.ilike.%${search}%,file_name.ilike.%${search}%`
        );
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (expiryFilter === 'expiring30') {
        const now = new Date();
        const in30 = new Date(now);
        in30.setDate(in30.getDate() + 30);
        query = query
          .gte('expiry_date', now.toISOString().split('T')[0])
          .lte('expiry_date', in30.toISOString().split('T')[0]);
      } else if (expiryFilter === 'expired') {
        query = query.lt('expiry_date', new Date().toISOString().split('T')[0]);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      setCerts((data as Certificate[]) ?? []);
      setTotal(count ?? 0);
    } catch (err) {
      console.error('Error fetching certs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
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
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b bg-card flex items-center justify-between px-6">
          <div>
            <h1 className="text-lg font-semibold">Documentos</h1>
            <p className="text-xs text-muted-foreground">{total} certificado{total !== 1 ? 's' : ''} no sistema</p>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3">
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
              </div>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : certs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                        Nenhum documento encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    certs.map((cert) => {
                      const statusCfg = STATUS_CONFIG[cert.status ?? ''] ?? {
                        label: cert.status ?? '—',
                        variant: 'outline' as const,
                        icon: null,
                      };
                      return (
                        <TableRow
                          key={cert.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelected(cert)}
                        >
                          <TableCell className="font-medium">
                            {cert.employee_name ?? '—'}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {cert.course_name ?? cert.file_name ?? '—'}
                          </TableCell>
                          <TableCell>
                            {cert.completion_date
                              ? format(new Date(cert.completion_date), 'dd/MM/yyyy')
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {expiryBadge(cert.expiry_date)}
                          </TableCell>
                          <TableCell>{cert.hours ?? '—'}</TableCell>
                          <TableCell>
                            <Badge
                              variant={statusCfg.variant}
                              className="flex items-center gap-1 w-fit"
                            >
                              {statusCfg.icon}
                              {statusCfg.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Página {page + 1} de {totalPages} ({total} registros)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Detail Sheet */}
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
                <DetailRow
                  label="Conclusão"
                  value={
                    selected.completion_date
                      ? format(new Date(selected.completion_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
                      : null
                  }
                />
                <DetailRow
                  label="Vencimento"
                  value={
                    selected.expiry_date
                      ? format(new Date(selected.expiry_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
                      : null
                  }
                />
                <DetailRow label="Carga horária" value={selected.hours ? `${selected.hours}h` : null} />
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge variant={STATUS_CONFIG[selected.status ?? '']?.variant ?? 'outline'}>
                    {STATUS_CONFIG[selected.status ?? '']?.label ?? selected.status ?? '—'}
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
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Abrir arquivo
                    </a>
                  </Button>
                )}
                {selected.created_at && (
                  <p className="text-xs text-muted-foreground text-center">
                    Processado em{' '}
                    {format(new Date(selected.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
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

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between py-2 border-b">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value ?? '—'}</span>
    </div>
  );
}
