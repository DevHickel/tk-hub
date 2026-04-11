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
  details: { file_name?: string; message?: string } | null;
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
  const { user, profile, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [expiringCerts, setExpiringCerts] = useState<ExpiringCert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchDashboardData();
  }, [user]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const in30Days = addDays(now, 30);

      const [
        docsRes,
        convsRes,
        msgsRes,
        certsRes,
        activityRes,
        expiringRes,
      ] = await Promise.all([
        supabase.from('documents').select('id', { count: 'exact', head: true }),
        supabase.from('conversations').select('id', { count: 'exact', head: true }),
        supabase.from('messages').select('id', { count: 'exact', head: true }),
        supabase.from('processed_certificates').select('status'),
        supabase
          .from('activity_logs')
          .select('id, action, details, timestamp, profiles(full_name, email)')
          .order('timestamp', { ascending: false })
          .limit(8),
        supabase
          .from('processed_certificates')
          .select('id, employee_name, course_name, expiry_date, status')
          .not('expiry_date', 'is', null)
          .gte('expiry_date', now.toISOString().split('T')[0])
          .lte('expiry_date', in30Days.toISOString().split('T')[0])
          .order('expiry_date', { ascending: true })
          .limit(5),
      ]);

      const certs = certsRes.data ?? [];
      setMetrics({
        totalDocs: docsRes.count ?? 0,
        totalConversations: convsRes.count ?? 0,
        totalMessages: msgsRes.count ?? 0,
        expiringDocs: expiringRes.data?.length ?? 0,
        expiredDocs: certs.filter((c) => c.status === 'rejected' || c.status === 'expired').length,
        pendingDocs: certs.filter((c) => c.status === 'pending').length,
        approvedDocs: certs.filter((c) => c.status === 'approved').length,
      });

      setRecentActivity((activityRes.data as RecentActivity[]) ?? []);
      setExpiringCerts((expiringRes.data as ExpiringCert[]) ?? []);
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
      <AppSidebar />

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
              label="Documentos"
              value={metrics?.totalDocs}
              icon={<FileText className="h-5 w-5 text-blue-500" />}
              loading={loading}
            />
            <MetricCard
              label="Certificados aprovados"
              value={metrics?.approvedDocs}
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
              label="Conversas"
              value={metrics?.totalConversations}
              icon={<MessageSquare className="h-5 w-5 text-purple-500" />}
              loading={loading}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Expiring certs */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-500" />
                  Vencimentos próximos
                </CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/documents" className="text-xs flex items-center gap-1">
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
                    Nenhum documento vencendo nos próximos 30 dias
                  </p>
                ) : (
                  <div className="space-y-2">
                    {expiringCerts.map((cert) => {
                      const days = cert.expiry_date ? daysUntilExpiry(cert.expiry_date) : null;
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
                          <Badge
                            variant="outline"
                            className={
                              days !== null && days <= 7
                                ? 'border-red-500 text-red-500'
                                : 'border-amber-500 text-amber-500'
                            }
                          >
                            {days !== null ? `${days}d` : '—'}
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

function formatAction(action: string, details: { file_name?: string; message?: string } | null): string {
  const map: Record<string, string> = {
    upload: 'Enviou documento',
    chat: 'Enviou mensagem no chat',
    login: 'Entrou no sistema',
    logout: 'Saiu do sistema',
    delete_document: 'Deletou documento',
    invite_sent: 'Enviou convite',
    role_changed: 'Alterou role de usuário',
  };
  const base = map[action] ?? action;
  if (details?.file_name) return `${base}: ${details.file_name}`;
  return base;
}
