import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Users, FileText, Activity, Search, Trash2, Upload, MessageSquare, Mail, Copy, UserPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useDeleteWithConfirmation } from '@/hooks/useDeleteWithConfirmation';

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

interface Document {
  id: number;
  content: string | null;
  metadata: unknown;
}

interface GroupedDocument {
  name: string;
  totalPages: number;
  ids: number[];
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
  'message_sent': 'Mensagem',
  'document_uploaded': 'Upload de Documento',
  'document_deleted': 'Documento Excluído',
  'permission_changed': 'Permissão Alterada',
  'user_login': 'Login',
  'user_logout': 'Logout',
  'invite_sent': 'Convite Enviado',
  'profile_updated': 'Perfil Atualizado',
};

const getActionLabel = (action: string): string => {
  return actionLabels[action] || action;
};

export default function Admin() {
  const navigate = useNavigate();
  const { profile, user, appRoles } = useAuth();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [docSearchTerm, setDocSearchTerm] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isAdmin } = useAuth();
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

  // Hook para exclusão de documento
  const docDelete = useDeleteWithConfirmation<number[]>({
    onDelete: async (docIds) => {
      const { error } = await supabase
        .from('documents')
        .delete()
        .in('id', docIds);
      
      if (error) throw error;
    },
    onSuccess: () => {
      const deletedIds = new Set(docDelete.itemToDelete || []);
      setDocuments(prev => prev.filter(d => !deletedIds.has(d.id)));
    },
    successMessage: 'Documento excluído',
    errorMessage: 'Erro ao excluir documento',
  });

  useEffect(() => {
    if (!isAdmin) {
      toast.error('Acesso negado');
      navigate('/chat');
      return;
    }
    fetchData();
  }, [isAdmin, navigate]);

  const fetchData = async () => {
    setIsLoading(true);
    await Promise.all([fetchUsers(), fetchActivityLogs(), fetchDocuments(), fetchInvites()]);
    setIsLoading(false);
  };

  const fetchUsers = async () => {
    // Fetch profiles
    const { data: profilesData, error: profilesError } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name');
    
    if (profilesError) {
      toast.error('Erro ao carregar usuários');
      return;
    }

    // Fetch user_roles to get actual app roles
    const { data: rolesData } = await supabase
      .from('user_roles')
      .select('user_id, role');

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

  const fetchDocuments = async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('id', { ascending: false });
    
    if (error) {
      toast.error('Erro ao carregar documentos');
      return;
    }
    setDocuments(data || []);
  };

  const fetchInvites = async () => {
    // Fetch invites
    const { data: invitesData, error: invitesError } = await supabase
      .from('invites')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (invitesError) {
      console.error('Error fetching invites:', invitesError);
      return;
    }

    // Fetch all registered users emails to check if invite was used
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('email');
    
    const registeredEmails = new Set(profilesData?.map(p => p.email?.toLowerCase()) || []);

    // Filter out invites where user has already registered
    const filteredInvites = (invitesData || []).filter(invite => {
      const isUserRegistered = registeredEmails.has(invite.email.toLowerCase());
      // If user registered, mark as accepted and don't show
      return !isUserRegistered;
    });

    setInvites(filteredInvites);
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error('Digite um email válido');
      return;
    }

    setIsSendingInvite(true);

    try {
      const { data, error } = await supabase.functions.invoke('send-invite', {
        body: {
          email: inviteEmail,
          invitedBy: user?.id,
        },
      });

      if (error) {
        console.error('Error sending invite:', error);
        toast.error('Erro ao enviar convite');
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      if (data?.warning) {
        toast.warning(data.warning);
      } else {
        toast.success('Convite enviado com sucesso! Email enviado para ' + inviteEmail);
      }

      setInviteEmail('');
      fetchInvites();
    } catch (err) {
      console.error('Error:', err);
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

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      const response = await fetch('https://n8n.vetorix.com.br/form/7fe68a76-3359-4fb9-8e63-4909d487f04e', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        toast.success('Documento enviado para processamento!');
        setTimeout(() => fetchDocuments(), 3000); // Refresh após 3s
      } else {
        toast.error('Erro ao enviar documento');
      }
    } catch (err) {
      console.error('Upload error:', err);
      toast.error('Erro ao enviar documento');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  };

  // Agrupar documentos por nome de arquivo
  const groupedDocuments: GroupedDocument[] = documents.reduce((acc, doc) => {
    const metadata = doc.metadata as Record<string, unknown> | null;
    const source = (metadata?.source as string) || `Documento ${doc.id}`;
    const existing = acc.find(d => d.name === source);
    
    if (existing) {
      existing.totalPages++;
      existing.ids.push(doc.id);
    } else {
      acc.push({
        name: source,
        totalPages: 1,
        ids: [doc.id],
      });
    }
    
    return acc;
  }, [] as GroupedDocument[]);

  const filteredDocuments = groupedDocuments.filter(doc =>
    doc.name.toLowerCase().includes(docSearchTerm.toLowerCase())
  );

  // Contar mensagens por usuário (usando user_id)
  const messageCountByUserId = activityLogs.reduce((acc, log) => {
    if (log.action === 'message_sent') {
      acc[log.user_id] = (acc[log.user_id] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  // Contar mensagens por nome para exibição nos logs
  const messageCountByUser = activityLogs.reduce((acc, log) => {
    if (log.action === 'message_sent') {
      const userName = log.profiles?.full_name || log.profiles?.email || log.user_id;
      acc[userName] = (acc[userName] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo size="sm" />
            <h1 className="text-xl font-semibold">Administração</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/chat')} className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Ir para Chat
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="grid w-full max-w-lg grid-cols-4">
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
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Documentos
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
                      const messageCount = log.action === 'message_sent' ? messageCountByUser[userName] || 0 : null;
                      
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
                            {messageCount !== null ? (
                              <Badge variant="secondary">{messageCount}</Badge>
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

          <TabsContent value="documents">
            <div className="space-y-6">
              {/* Upload Section */}
              <Card>
                <CardHeader>
                  <CardTitle>Upload de Documento</CardTitle>
                  <CardDescription>Envie arquivos PDF para processamento e indexação</CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className={`
                      relative border-2 border-dashed rounded-lg p-8 text-center 
                      transition-all duration-300 ease-in-out cursor-pointer
                      ${isDragOver 
                        ? 'border-primary bg-primary/10 scale-[1.02]' 
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      }
                      ${isUploading ? 'opacity-50 pointer-events-none' : ''}
                    `}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => handleFileUpload(e.target.files)}
                    />
                    <div className={`flex flex-col items-center gap-3 transition-transform duration-300 ${isDragOver ? 'scale-110' : ''}`}>
                      <Upload className={`h-10 w-10 transition-colors duration-300 ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div>
                        <p className="font-medium">
                          {isUploading ? 'Enviando...' : 'Arraste arquivos aqui ou clique para selecionar'}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Suporta arquivos PDF
                        </p>
                      </div>
                    </div>
                    {isUploading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-lg">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Documents List */}
              <Card>
                <CardHeader>
                  <CardTitle>Documentos Processados</CardTitle>
                  <CardDescription>Gerencie e exclua documentos indexados no sistema</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por nome do arquivo..."
                      value={docSearchTerm}
                      onChange={(e) => setDocSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome do Arquivo</TableHead>
                        <TableHead className="text-right">Total de Páginas/Chunks</TableHead>
                        <TableHead className="w-20 text-center">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDocuments.map((doc) => (
                        <TableRow key={doc.name}>
                          <TableCell className="font-medium">{doc.name}</TableCell>
                          <TableCell className="text-right">{doc.totalPages}</TableCell>
                          <TableCell className="text-center">
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => docDelete.requestDelete(doc.ids)}
                              disabled={docDelete.isDeleting}
                              title="Excluir documento"
                            >
                              {docDelete.isDeleting && JSON.stringify(docDelete.itemToDelete) === JSON.stringify(doc.ids) ? (
                                <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                              ) : (
                                <Trash2 className="h-4 w-4 text-destructive" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredDocuments.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                            Nenhum documento encontrado
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Diálogo de confirmação - Excluir Usuário */}
      <DeleteConfirmDialog
        open={userDelete.isDialogOpen}
        onOpenChange={(open) => !open && userDelete.cancelDelete()}
        onConfirm={userDelete.confirmDelete}
        isDeleting={userDelete.isDeleting}
        title="Excluir usuário?"
        description="Esta ação não pode ser desfeita. O usuário e todos os seus dados (conversas, mensagens, logs, bug reports) serão permanentemente removidos."
      />

      {/* Diálogo de confirmação - Excluir Convite */}
      <DeleteConfirmDialog
        open={inviteDelete.isDialogOpen}
        onOpenChange={(open) => !open && inviteDelete.cancelDelete()}
        onConfirm={inviteDelete.confirmDelete}
        isDeleting={inviteDelete.isDeleting}
        title="Excluir convite?"
        description="Esta ação não pode ser desfeita. O convite será permanentemente removido."
      />

      {/* Diálogo de confirmação - Excluir Documento */}
      <DeleteConfirmDialog
        open={docDelete.isDialogOpen}
        onOpenChange={(open) => !open && docDelete.cancelDelete()}
        onConfirm={docDelete.confirmDelete}
        isDeleting={docDelete.isDeleting}
        title="Excluir documento?"
        description="Esta ação não pode ser desfeita. O documento e todos os seus chunks serão permanentemente removidos."
      />
    </div>
  );
}
