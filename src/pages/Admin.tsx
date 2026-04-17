import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AppSidebar } from '@/components/AppSidebar';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import { Users, Activity, Search, Trash2, Mail, Copy, UserPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useDeleteWithConfirmation } from '@/hooks/useDeleteWithConfirmation';
import { logActivity } from '@/lib/activity';

type AppRole = 'admin' | 'user' | 'tk_master';

interface UserWithRole {
  id: string;
  email: string | null;
  full_name: string | null;
  account_status: string | null;
  last_sign_in_at: string | null;
  app_role: AppRole;
}

const roleLabels: Record<AppRole, string> = {
  tk_master: 'TK Owner',
  admin: 'Admin',
  user: 'Usuário',
};

interface ActivityLog {
  id: number;
  user_id: string;
  action: string;
  details: unknown;
  timestamp: string | null;
  profiles?: { full_name: string | null; email: string | null };
}

interface Invite {
  id: string;
  email: string;
  invited_by: string;
  token: string;
  status: string;
  created_at: string;
  expires_at: string;
}

// Mapa de ações para nomes amigáveis
const actionLabels: Record<string, string> = {
  'message_sent': 'Enviou mensagem',
  'certificate_uploaded': 'Enviou certificado',
  'certificate_deleted': 'Excluiu certificado',
  'rag_document_uploaded': 'Enviou documento para IA',
  'rag_document_deleted': 'Excluiu documento da IA',
  'document_uploaded': 'Enviou documento',
  'document_deleted': 'Excluiu documento',
  'permission_changed': 'Alterou permissão',
  'user_login': 'Entrou no sistema',
  'user_logout': 'Saiu do sistema',
  'invite_sent': 'Enviou convite',
  'profile_updated': 'Atualizou perfil',
  'upload': 'Enviou documento',
  'delete_document': 'Excluiu documento',
};

const getActionLabel = (action: string): string => {
  return actionLabels[action] || action;
};

export default function Admin() {
  const navigate = useNavigate();
  const { profile, user, appRoles } = useAuth();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar, schedulePendingCollapse } = useSidebarCollapsed();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSendingInvite, setIsSendingInvite] = useState(false);

  const { isAdmin, loading: authLoading } = useAuth();
  const isTkMaster = appRoles.includes('tk_master');

  // Hook para exclusão de usuário com cascade
  const userDelete = useDeleteWithConfirmation<string>({
    onDelete: async (userId) => {
      // Apenas TK Masters podem deletar usuários
      if (!isTkMaster) {
        throw new Error('Sem permissão para excluir usuários');
      }

      // 1. Deletar bug_reports do usuário
      await supabase
        .from('bug_reports')
        .delete()
        .eq('user_id', userId);

      // 2. Deletar mensagens das conversas do usuário
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('user_id', userId);
      
      if (conversations && conversations.length > 0) {
        const conversationIds = conversations.map(c => c.id);
        await supabase
          .from('messages')
          .delete()
          .in('conversation_id', conversationIds);
      }

      // 3. Deletar conversas do usuário
      await supabase
        .from('conversations')
        .delete()
        .eq('user_id', userId);

      // 4. Deletar logs de atividade do usuário
      await supabase
        .from('activity_logs')
        .delete()
        .eq('user_id', userId);

      // 5. Deletar roles do usuário
      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

      // 6. Deletar convites feitos pelo usuário
      await supabase
        .from('invites')
        .delete()
        .eq('invited_by', userId);

      // 7. Deletar profile do usuário
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (profileError) {
        throw profileError;
      }
    },
    onSuccess: () => {
      setUsers(prev => prev.filter(u => u.id !== userDelete.itemToDelete));
      fetchActivityLogs();
    },
    successMessage: 'Usuário e todos os dados relacionados foram excluídos',
    errorMessage: 'Erro ao excluir usuário',
  });

  // Hook para exclusão de convite
  const inviteDelete = useDeleteWithConfirmation<string>({
    onDelete: async (inviteId) => {
      const { error } = await supabase
        .from('invites')
        .delete()
        .eq('id', inviteId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      setInvites(prev => prev.filter(i => i.id !== inviteDelete.itemToDelete));
    },
    successMessage: 'Convite excluído',
    errorMessage: 'Erro ao excluir convite',
  });


  useEffect(() => {
    if (authLoading) return; // wait for auth to resolve
    if (!isAdmin) {
      toast.error('Acesso negado');
      navigate('/dashboard');
      return;
    }
    fetchData();
  }, [isAdmin, authLoading, navigate]);

  const fetchData = async () => {
    setIsLoading(true);
    await Promise.all([fetchUsers(), fetchActivityLogs(), fetchInvites()]);
    setIsLoading(false);
  };

  const fetchUsers = async () => {
    // Fetch profiles and roles in parallel
    const [profilesRes, rolesRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, email, full_name, account_status, last_sign_in_at')
        .not('full_name', 'is', null)
        .order('full_name'),
      supabase
        .from('user_roles')
        .select('user_id, role'),
    ]);

    if (profilesRes.error) {
      toast.error('Erro ao carregar usuários');
      return;
    }

    const profilesData = profilesRes.data;
    const rolesData = rolesRes.data;

    const rolesMap = new Map<string, AppRole>();
    rolesData?.forEach(r => rolesMap.set(r.user_id, r.role as AppRole));

    // Combine profiles with their app roles
    const usersWithRoles: UserWithRole[] = (profilesData || []).map(p => ({
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      account_status: p.account_status,
      last_sign_in_at: p.last_sign_in_at,
      app_role: rolesMap.get(p.id) || 'user',
    }));

    setUsers(usersWithRoles);
  };

  const fetchActivityLogs = async () => {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*, profiles(full_name, email)')
      .order('timestamp', { ascending: false })
      .limit(100);
    
    if (error) {
      toast.error('Erro ao carregar logs');
      return;
    }
    setActivityLogs(data || []);
  };


  const fetchInvites = async () => {
    // Fetch only pending invites
    const { data: invitesData, error: invitesError } = await supabase
      .from('invites')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    if (invitesError) {
      console.error('Error fetching invites:', invitesError);
      return;
    }

    setInvites(invitesData || []);
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error('Digite um email válido');
      return;
    }

    setIsSendingInvite(true);

    try {
      // Call n8n webhook directly - all invite logic is handled by n8n
      const response = await fetch('https://n8n.vetorix.com.br/webhook/convite-usuario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          invitedBy: user?.id,
          inviterEmail: profile?.email,
          origin: window.location.origin,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error('Webhook request failed');
      }

      // With no-cors mode, we can't read the response
      // Show success message and let user verify in n8n
      toast.success('Convite enviado para processamento! Verifique o n8n.');
      if (user) await logActivity(user.id, 'invite_sent', { email: inviteEmail });
      setInviteEmail('');
      fetchInvites();
    } catch (err) {
      console.error('Error sending invite:', err);
      toast.error('Erro ao enviar convite');
    } finally {
      setIsSendingInvite(false);
    }
  };

  const copyInviteLink = (token: string, email: string) => {
    const baseUrl = window.location.origin;
    const link = `${baseUrl}/register?token=${token}&email=${encodeURIComponent(email)}`;
    navigator.clipboard.writeText(link);
    toast.success('Link copiado para a área de transferência!');
  };

  const getStatusBadge = (status: string, expiresAt: string) => {
    const isExpired = new Date(expiresAt) < new Date();
    if (isExpired && status === 'pending') {
      return <Badge variant="destructive">Expirado</Badge>;
    }
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Pendente</Badge>;
      case 'accepted':
        return <Badge variant="default">Aceito</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const updateUserRole = async (userId: string, newRole: AppRole) => {
    // Update user_roles table (this is the source of truth)
    const { data: existingRole } = await supabase
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existingRole) {
      // Update existing role
      const { error: roleError } = await supabase
        .from('user_roles')
        .update({ role: newRole })
        .eq('user_id', userId);
      
      if (roleError) {
        toast.error('Erro ao atualizar cargo');
        console.error('Error updating user_roles:', roleError);
        return;
      }
    } else {
      // Insert new role if doesn't exist
      const { error: insertError } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: newRole });
      
      if (insertError) {
        toast.error('Erro ao atualizar cargo');
        console.error('Error inserting user_role:', insertError);
        return;
      }
    }

    // Also update profile role for backwards compatibility (admin/user only)
    const profileRole = newRole === 'user' ? 'user' : 'admin';
    await supabase
      .from('profiles')
      .update({ role: profileRole })
      .eq('id', userId);

    toast.success('Cargo atualizado');
    fetchUsers();
  };


  // Contar mensagens por usuário (usando user_id)
  const messageCountByUserId = activityLogs.reduce((acc, log) => {
    if (log.action === 'message_sent') {
      acc[log.user_id] = (acc[log.user_id] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  // Pontuação cumulativa por usuário: percorre os logs do mais antigo ao mais recente
  // e atribui 1, 2, 3... para cada mensagem do mesmo usuário
  const cumulativeScoreByLogId = (() => {
    const counters: Record<string, number> = {};
    const result: Record<number, number> = {};
    // activityLogs is newest-first, so reverse to count chronologically
    const chronological = [...activityLogs].reverse();
    for (const log of chronological) {
      if (log.action === 'message_sent') {
        counters[log.user_id] = (counters[log.user_id] || 0) + 1;
        result[log.id] = counters[log.user_id];
      }
    }
    return result;
  })();

  const filteredUsers = users.filter(user =>
    user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} onCollapse={schedulePendingCollapse} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b bg-card flex items-center justify-between px-6">
          <div>
            <h1 className="text-lg font-semibold">Administração</h1>
            <p className="text-xs text-muted-foreground">Usuários, convites e atividade</p>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1 overflow-y-auto p-6">
        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Usuários
            </TabsTrigger>
            <TabsTrigger value="invites" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Convites
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Gerenciar Usuários</span>
                  <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar usuário..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Mensagens</TableHead>
                      <TableHead>Último Acesso</TableHead>
                      {isTkMaster && <TableHead className="w-16">Ações</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((userItem) => {
                      // TK Masters can edit everyone except themselves
                      // Admins can only edit users with 'user' role (not other admins or tk_masters)
                      const isOwnProfile = userItem.id === profile?.id;
                      const canEditRole = isTkMaster 
                        ? !isOwnProfile 
                        : (userItem.app_role === 'user' && !isOwnProfile);
                      
                      return (
                        <TableRow key={userItem.id}>
                          <TableCell className="font-medium">{userItem.full_name || '-'}</TableCell>
                          <TableCell>{userItem.email || '-'}</TableCell>
                          <TableCell>
                            <Select
                              value={userItem.app_role}
                              onValueChange={(value: AppRole) => updateUserRole(userItem.id, value)}
                              disabled={!canEditRole}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue>{roleLabels[userItem.app_role]}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {isTkMaster && <SelectItem value="tk_master">TK Owner</SelectItem>}
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="user">Usuário</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {messageCountByUserId[userItem.id] || 0}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {userItem.last_sign_in_at 
                              ? format(new Date(userItem.last_sign_in_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
                              : '-'}
                          </TableCell>
                          {isTkMaster && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => userDelete.requestDelete(userItem.id)}
                                disabled={userItem.id === profile?.id || userDelete.isDeleting}
                                title="Excluir usuário"
                              >
                                {userDelete.isDeleting && userDelete.itemToDelete === userItem.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                                ) : (
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                )}
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invites">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Convidar Usuários</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Input
                      type="email"
                      placeholder="Email do convidado..."
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
                    />
                  </div>
                  <Button onClick={sendInvite} disabled={isSendingInvite} className="flex items-center gap-2">
                    {isSendingInvite ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground border-t-transparent" />
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" />
                        Enviar Convite
                      </>
                    )}
                  </Button>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-4">Convites Pendentes</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Criado em</TableHead>
                        <TableHead>Expira em</TableHead>
                        <TableHead className="w-24">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invites.map((invite) => {
                        const isExpired = new Date(invite.expires_at) < new Date();
                        return (
                          <TableRow key={invite.id}>
                            <TableCell className="font-medium">{invite.email}</TableCell>
                            <TableCell>{getStatusBadge(invite.status, invite.expires_at)}</TableCell>
                            <TableCell>
                              {format(new Date(invite.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </TableCell>
                            <TableCell>
                              {format(new Date(invite.expires_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {invite.status === 'pending' && !isExpired && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => copyInviteLink(invite.token, invite.email)}
                                    title="Copiar link de convite"
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => inviteDelete.requestDelete(invite.id)}
                                  disabled={inviteDelete.isDeleting}
                                  title="Excluir convite"
                                >
                                  {inviteDelete.isDeleting && inviteDelete.itemToDelete === invite.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                                  ) : (
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {invites.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            Nenhum convite pendente
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs">
            <Card>
              <CardHeader>
                <CardTitle>Logs de Atividade</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data/Hora</TableHead>
                      <TableHead>Usuário</TableHead>
                      <TableHead>Ação</TableHead>
                      <TableHead>Pontuação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activityLogs.map((log) => {
                      const userName = log.profiles?.full_name || log.profiles?.email || '-';
                      const score = cumulativeScoreByLogId[log.id];

                      return (
                        <TableRow key={log.id}>
                          <TableCell>
                            {log.timestamp
                              ? format(new Date(log.timestamp), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })
                              : '-'}
                          </TableCell>
                          <TableCell>{userName}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{getActionLabel(log.action)}</Badge>
                          </TableCell>
                          <TableCell>
                            {score != null ? (
                              <Badge variant="secondary">{score}</Badge>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>



        </Tabs>
        </main>
      </div>

      {/* Diálogos de confirmação */}
      <DeleteConfirmDialog
        open={userDelete.isDialogOpen}
        onOpenChange={(open) => !open && userDelete.cancelDelete()}
        onConfirm={userDelete.confirmDelete}
        isDeleting={userDelete.isDeleting}
        title="Excluir usuário?"
        description="Esta ação não pode ser desfeita. O usuário e todos os seus dados (conversas, mensagens, logs, bug reports) serão permanentemente removidos."
      />
      <DeleteConfirmDialog
        open={inviteDelete.isDialogOpen}
        onOpenChange={(open) => !open && inviteDelete.cancelDelete()}
        onConfirm={inviteDelete.confirmDelete}
        isDeleting={inviteDelete.isDeleting}
        title="Excluir convite?"
        description="Esta ação não pode ser desfeita. O convite será permanentemente removido."
      />
    </div>
  );
}

