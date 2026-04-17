import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AppSidebar } from '@/components/AppSidebar';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import {
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  ArrowRight,
  TrendingUp,
  MessageSquare,
  Shield,
} from 'lucide-react';
import { format, formatDistanceToNow, addDays, isAfter, isBefore } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface DashboardMetrics {
  totalDocs: number;
  totalCerts: number;
  totalConversations: number;
  totalMessages: number;
  expiringDocs: number; // expiry within 30 days
  expiredDocs: number;
  pendingDocs: number;
  approvedDocs: number;
}

interface RecentActivity {
  id: number;
  action: string;
  details: Record<string, unknown> | null;
  timestamp: string | null;
  profiles?: { full_name: string | null; email: string | null } | null;
}

interface ExpiringCert {
  id: string;
  employee_name: string | null;
  course_name: string | null;
  expiry_date: string | null;
  status: string | null;
}

export default function Dashboard() {
  const { user, profile, signOut, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar, schedulePendingCollapse } = useSidebarCollapsed();

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [expiringCerts, setExpiringCerts] = useState<ExpiringCert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    fetchDashboardData();
  }, [user, authLoading]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const in30Days = addDays(now, 30);

      const [
        docsRes,
        certsRes,
        activityRes,
        expiredRes,
      ] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.rpc as any)('count_rag_documents'),
        supabase.from('processed_certificates').select('status, employee_name'),
        supabase
          .from('activity_logs')
          .select('id, action, details, timestamp, profiles(full_name, email)')
          .order('timestamp', { ascending: false })
          .limit(8),
        // Certs vencidos (expiry_date < hoje)
        supabase
          .from('processed_certificates')
          .select('id, employee_name, course_name, expiry_date, status')
          .not('expiry_date', 'is', null)
          .lt('expiry_date', now.toISOString().split('T')[0])
          .order('expiry_date', { ascending: false })
          .limit(5),
      ]);

      const certs = certsRes.data ?? [];
      // "Analisados": employee_name preenchido (IA processou)
      const analyzed = certs.filter((c) => c.employee_name != null);
      // "Não analisados": employee_name ainda null (pendente de IA)
      const notAnalyzed = certs.filter((c) => c.employee_name == null);
      // Vencendo em 30 dias (não vencidos ainda)
      const today = now.toISOString().split('T')[0];
      const in30DaysStr = in30Days.toISOString().split('T')[0];
      const expiringSoon = certs.filter((c) => {
        const d = (c as { expiry_date?: string | null }).expiry_date;
        return d && d >= today && d <= in30DaysStr;
      });

      setMetrics({
        totalDocs: (docsRes.data as unknown as number) ?? 0,
        totalCerts: analyzed.length,
        totalConversations: 0,
        totalMessages: 0,
        expiringDocs: expiringSoon.length,
        expiredDocs: (expiredRes.data?.length ?? 0),
        pendingDocs: notAnalyzed.length,
        approvedDocs: analyzed.length,
      });

      setRecentActivity((activityRes.data as RecentActivity[]) ?? []);
      setExpiringCerts((expiredRes.data as ExpiringCert[]) ?? []);
    } catch (err) {
      console.error('Error fetching dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const daysUntilExpiry = (dateStr: string) => {
    const expiry = new Date(dateStr);
    const now = new Date();
    const diff = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} onCollapse={schedulePendingCollapse} />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b bg-card flex items-center justify-between px-6">
          <div>
            <h1 className="text-lg font-semibold">Dashboard</h1>
            <p className="text-xs text-muted-foreground">
              Olá, {profile?.full_name?.split(' ')[0] ?? 'usuário'}
            </p>
          </div>
          <ThemeToggle />
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Quick actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ações rápidas</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/chat">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Abrir Assistente
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/documents">
                  <FileText className="h-4 w-4 mr-2" />
                  Ver Documentos
                </Link>
              </Button>
              {isAdmin && (
                <Button variant="outline" asChild>
                  <Link to="/admin">
                    <Shield className="h-4 w-4 mr-2" />
                    Painel Admin
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Docs. RAG indexados"
              value={metrics?.totalDocs}
              icon={<FileText className="h-5 w-5 text-blue-500" />}
              loading={loading}
            />
            <MetricCard
              label="Certificados analisados"
              value={metrics?.totalCerts}
              icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
              loading={loading}
            />
            <MetricCard
              label="Vencendo em 30 dias"
              value={metrics?.expiringDocs}
              icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
              loading={loading}
              highlight={!!metrics?.expiringDocs}
            />
            <MetricCard
              label="Aguardando análise"
              value={metrics?.pendingDocs}
              icon={<Clock className="h-5 w-5 text-orange-500" />}
              loading={loading}
              highlight={!!metrics?.pendingDocs}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Expired certs */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  Certificados vencidos
                </CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/documents?expiry=expired" className="text-xs flex items-center gap-1">
                    Ver todos <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : expiringCerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nenhum certificado vencido
                  </p>
                ) : (
                  <div className="space-y-2">
                    {expiringCerts.map((cert) => {
                      const daysPast = cert.expiry_date ? Math.abs(daysUntilExpiry(cert.expiry_date)) : null;
                      return (
                        <div
                          key={cert.id}
                          className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {cert.employee_name ?? '—'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {cert.course_name ?? '—'}
                            </p>
                          </div>
                          <Badge variant="outline" className="border-red-500 text-red-500 shrink-0">
                            {daysPast !== null ? `há ${daysPast}d` : '—'}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent activity */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-500" />
                  Atividade recente
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : recentActivity.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nenhuma atividade registrada
                  </p>
                ) : (
                  <div className="space-y-1">
                    {recentActivity.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-start justify-between py-2 border-b last:border-0 gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {log.profiles?.full_name ?? log.profiles?.email ?? 'Sistema'}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {formatAction(log.action, log.details)}
                          </p>
                        </div>
                        {log.timestamp && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                            {formatDistanceToNow(new Date(log.timestamp), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

        </main>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  loading,
  highlight,
}: {
  label: string;
  value?: number;
  icon: React.ReactNode;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-amber-500/50' : ''}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <span className="text-3xl font-bold">{value ?? 0}</span>
        )}
      </CardContent>
    </Card>
  );
}

function formatAction(action: string, details: Record<string, unknown> | null): string {
  const d = details as { file_name?: string; email?: string } | null;

  switch (action) {
    case 'message_sent':
      return 'Enviou mensagem no assistente';
    case 'invite_sent':
      return d?.email ? `Enviou convite para ${d.email}` : 'Enviou convite de registro';
    case 'certificate_uploaded':
      return d?.file_name ? `Enviou certificado: ${d.file_name}` : 'Enviou certificado';
    case 'rag_document_uploaded':
      return d?.file_name ? `Enviou documento para IA: ${d.file_name}` : 'Enviou documento para IA';
    case 'rag_document_deleted':
      return d?.file_name ? `Excluiu documento da IA: ${d.file_name}` : 'Excluiu documento da IA';
    case 'certificate_deleted':
      return d?.file_name ? `Excluiu certificado: ${d.file_name}` : 'Excluiu certificado';
    case 'permission_changed':
      return 'Alterou permissão de usuário';
    case 'user_login':
      return 'Entrou no sistema';
    case 'user_logout':
      return 'Saiu do sistema';
    case 'profile_updated':
      return 'Atualizou o perfil';
    // legacy actions
    case 'upload':
      return d?.file_name ? `Enviou documento: ${d.file_name}` : 'Enviou documento';
    case 'delete_document':
      return d?.file_name ? `Excluiu documento: ${d.file_name}` : 'Excluiu documento';
    default:
      return action.replace(/_/g, ' ');
  }
}
