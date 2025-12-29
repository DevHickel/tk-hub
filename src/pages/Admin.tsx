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
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Users, FileText, Activity, Search, Trash2, Upload, Eye, MessageSquare, Mail, Copy, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'admin' | 'user';
  account_status: string | null;
  last_sign_in_at: string | null;
}

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

interface Invite {
  id: string;
  email: string;
  invited_by: string;
  token: string;
  status: string;
  created_at: string;
  expires_at: string;
}

export default function Admin() {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSendingInvite, setIsSendingInvite] = useState(false);

  const { isAdmin } = useAuth();

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
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name');
    
    if (error) {
      toast.error('Erro ao carregar usuários');
      return;
    }
    setUsers(data || []);
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
    const { data, error } = await supabase
      .from('invites')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching invites:', error);
      return;
    }
    setInvites(data || []);
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error('Digite um email válido');
      return;
    }

    // Check if email is already invited
    const existingInvite = invites.find(i => i.email === inviteEmail && i.status === 'pending');
    if (existingInvite) {
      toast.error('Este email já possui um convite pendente');
      return;
    }

    // Check if user already exists
    const existingUser = users.find(u => u.email === inviteEmail);
    if (existingUser) {
      toast.error('Este email já está cadastrado');
      return;
    }

    setIsSendingInvite(true);

    const { error } = await supabase
      .from('invites')
      .insert({
        email: inviteEmail,
        invited_by: user?.id,
      });

    if (error) {
      toast.error('Erro ao enviar convite');
      setIsSendingInvite(false);
      return;
    }

    toast.success('Convite criado com sucesso!');
    setInviteEmail('');
    fetchInvites();
    setIsSendingInvite(false);
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

  const updateUserRole = async (userId: string, newRole: 'admin' | 'user') => {
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);
    
    if (error) {
      toast.error('Erro ao atualizar cargo');
      return;
    }
    toast.success('Cargo atualizado');
    fetchUsers();
  };

  const updateAccountStatus = async (userId: string, status: string) => {
    const { error } = await supabase
      .from('profiles')
      .update({ account_status: status })
      .eq('id', userId);
    
    if (error) {
      toast.error('Erro ao atualizar status');
      return;
    }
    toast.success('Status atualizado');
    fetchUsers();
  };

  const deleteDocument = async (docId: number) => {
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', docId);
    
    if (error) {
      toast.error('Erro ao excluir documento');
      return;
    }
    toast.success('Documento excluído');
    fetchDocuments();
  };

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
                      <TableHead>Status</TableHead>
                      <TableHead>Último Acesso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.full_name || '-'}</TableCell>
                        <TableCell>{user.email || '-'}</TableCell>
                        <TableCell>
                          <Select
                            value={user.role}
                            onValueChange={(value: 'admin' | 'user') => updateUserRole(user.id, value)}
                            disabled={user.id === profile?.id}
                          >
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="user">Usuário</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={user.account_status || 'active'}
                            onValueChange={(value) => updateAccountStatus(user.id, value)}
                            disabled={user.id === profile?.id}
                          >
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Ativo</SelectItem>
                              <SelectItem value="suspended">Suspenso</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {user.last_sign_in_at 
                            ? format(new Date(user.last_sign_in_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
                            : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
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
                  <h3 className="text-sm font-medium text-muted-foreground mb-4">Convites Enviados</h3>
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
                      {invites.map((invite) => (
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
                            {invite.status === 'pending' && new Date(invite.expires_at) > new Date() && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => copyInviteLink(invite.token, invite.email)}
                                title="Copiar link de convite"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {invites.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            Nenhum convite enviado ainda
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
                      <TableHead>Detalhes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activityLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          {log.timestamp 
                            ? format(new Date(log.timestamp), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })
                            : '-'}
                        </TableCell>
                        <TableCell>{log.profiles?.full_name || log.profiles?.email || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.action}</Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {log.details ? JSON.stringify(log.details) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Gestão de Documentos</span>
                  <Button className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Upload
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Conteúdo</TableHead>
                      <TableHead>Metadata</TableHead>
                      <TableHead className="w-24">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell>{doc.id}</TableCell>
                        <TableCell className="max-w-xs truncate">
                          {doc.content?.substring(0, 100) || '-'}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {doc.metadata ? JSON.stringify(doc.metadata) : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="icon">
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => deleteDocument(doc.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
