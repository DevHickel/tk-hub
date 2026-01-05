import { useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ArrowLeft, Bug, Send, Upload, X, List, Image as ImageIcon, Trash2, CheckCircle, Clock, Search, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useDeleteWithConfirmation } from '@/hooks/useDeleteWithConfirmation';

interface BugReportData {
  id: string;
  description: string;
  screenshot_url: string | null;
  created_at: string | null;
  user_id: string | null;
  status: string;
  user_name?: string;
}

export default function BugReport() {
  const navigate = useNavigate();
  const { user, profile, appRoles } = useAuth();
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reports, setReports] = useState<BugReportData[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [isHoveringUpload, setIsHoveringUpload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterName, setFilterName] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const canManageReports = profile?.role === 'admin' || appRoles.includes('admin') || appRoles.includes('tk_master');

  // Filtered reports
  const filteredReports = useMemo(() => {
    return reports.filter(report => {
      // Status filter
      if (filterStatus !== 'all' && report.status !== filterStatus) {
        return false;
      }
      
      // Name filter
      if (filterName && !report.user_name?.toLowerCase().includes(filterName.toLowerCase())) {
        return false;
      }
      
      // Date filter
      if (filterDateFrom || filterDateTo) {
        if (!report.created_at) return false;
        const reportDate = parseISO(report.created_at);
        
        if (filterDateFrom && filterDateTo) {
          if (!isWithinInterval(reportDate, {
            start: startOfDay(parseISO(filterDateFrom)),
            end: endOfDay(parseISO(filterDateTo))
          })) {
            return false;
          }
        } else if (filterDateFrom) {
          if (reportDate < startOfDay(parseISO(filterDateFrom))) {
            return false;
          }
        } else if (filterDateTo) {
          if (reportDate > endOfDay(parseISO(filterDateTo))) {
            return false;
          }
        }
      }
      
      return true;
    });
  }, [reports, filterStatus, filterName, filterDateFrom, filterDateTo]);

  const fetchReports = async () => {
    if (!canManageReports) return;
    
    setIsLoadingReports(true);
    const { data, error } = await supabase
      .from('bug_reports')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      toast.error('Erro ao carregar reports');
      setIsLoadingReports(false);
      return;
    }

    // Fetch user profiles for each report
    const userIds = [...new Set((data || []).map(r => r.user_id).filter(Boolean))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);

    const profileMap = new Map(profiles?.map(p => [p.id, p.full_name || p.email || 'Usuário desconhecido']) || []);
    
    const reportsWithNames = (data || []).map(report => ({
      ...report,
      user_name: report.user_id ? profileMap.get(report.user_id) || 'Usuário desconhecido' : 'Usuário desconhecido'
    }));

    setReports(reportsWithNames);
    setIsLoadingReports(false);
  };

  const toggleStatus = async (reportId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'pending' ? 'fixed' : 'pending';
    const { error } = await supabase
      .from('bug_reports')
      .update({ status: newStatus })
      .eq('id', reportId);
    
    if (error) {
      toast.error('Erro ao atualizar status');
    } else {
      setReports(reports.map(r => r.id === reportId ? { ...r, status: newStatus } : r));
      toast.success(newStatus === 'fixed' ? 'Marcado como corrigido' : 'Marcado como pendente');
    }
  };

  // Hook para exclusão de bug report com confirmação
  const reportDelete = useDeleteWithConfirmation<string>({
    onDelete: async (reportId) => {
      const { error } = await supabase
        .from('bug_reports')
        .delete()
        .eq('id', reportId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      setReports(prev => prev.filter(r => r.id !== reportDelete.itemToDelete));
    },
    successMessage: 'Report excluído',
    errorMessage: 'Erro ao excluir report',
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('A imagem deve ter no máximo 5MB');
        return;
      }
      setScreenshot(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const removeScreenshot = () => {
    setScreenshot(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      toast.error('Descreva o problema encontrado');
      return;
    }

    if (!user) {
      toast.error('Você precisa estar logado');
      return;
    }

    setIsSubmitting(true);
    let screenshotUrl: string | null = null;

    try {
      // Upload screenshot if present
      if (screenshot) {
        const fileExt = screenshot.name.split('.').pop();
        const fileName = `${user.id}/${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('bug-screenshots')
          .upload(fileName, screenshot);
        
        if (uploadError) {
          console.error('Upload error:', uploadError);
        } else {
          const { data: { publicUrl } } = supabase.storage
            .from('bug-screenshots')
            .getPublicUrl(fileName);
          screenshotUrl = publicUrl;
        }
      }

      // Insert into database
      const { error } = await supabase
        .from('bug_reports')
        .insert({
          description: description.trim(),
          screenshot_url: screenshotUrl,
          user_id: user.id
        });

      if (error) {
        throw error;
      }

      // Send to webhook
      try {
        await fetch('https://n8n.vetorix.com.br/webhook/18b9789c-327b-4d33-9eff-d2485fb389a9', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            empresa: 'TK Solution',
            usuario: profile?.full_name || profile?.email || user.email || 'Usuário desconhecido',
            descricao: description.trim(),
            link_imagem: screenshotUrl || null
          }),
        });
      } catch (webhookError) {
        console.error('Webhook error:', webhookError);
        // Don't fail the submission if webhook fails
      }

      toast.success('Report enviado com sucesso!');
      setDescription('');
      removeScreenshot();
    } catch (error) {
      console.error('Submit error:', error);
      toast.error('Erro ao enviar report');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/chat')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Logo size="sm" />
            <h1 className="text-xl font-semibold">Reportar Bug</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-6xl">
        {canManageReports ? (
          <Tabs defaultValue="send" className="space-y-6" onValueChange={(v) => v === 'manage' && fetchReports()}>
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="send" className="flex items-center gap-2">
                <Send className="h-4 w-4" />
                Enviar Report
              </TabsTrigger>
              <TabsTrigger value="manage" className="flex items-center gap-2">
                <List className="h-4 w-4" />
                Gerenciar Reports
              </TabsTrigger>
            </TabsList>

            <TabsContent value="send">
              <ReportForm
                description={description}
                setDescription={setDescription}
                screenshot={screenshot}
                previewUrl={previewUrl}
                isHoveringUpload={isHoveringUpload}
                setIsHoveringUpload={setIsHoveringUpload}
                fileInputRef={fileInputRef}
                handleFileSelect={handleFileSelect}
                removeScreenshot={removeScreenshot}
                handleSubmit={handleSubmit}
                isSubmitting={isSubmitting}
              />
            </TabsContent>

            <TabsContent value="manage">
              <Card>
                <CardHeader>
                  <CardTitle>Reports Recebidos</CardTitle>
                  <CardDescription>
                    Visualize todos os reports de bugs enviados pelos usuários
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Filters */}
                  <div className="flex flex-wrap gap-4 p-4 bg-muted/50 rounded-lg">
                    <div className="flex-1 min-w-[200px]">
                      <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
                      <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger>
                          <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="pending">Pendente</SelectItem>
                          <SelectItem value="fixed">Corrigido</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <Label className="text-xs text-muted-foreground mb-1 block">Nome do usuário</Label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input 
                          placeholder="Buscar por nome..." 
                          value={filterName}
                          onChange={(e) => setFilterName(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                    </div>
                    <div className="flex-1 min-w-[150px]">
                      <Label className="text-xs text-muted-foreground mb-1 block">Data inicial</Label>
                      <Input 
                        type="date" 
                        value={filterDateFrom}
                        onChange={(e) => setFilterDateFrom(e.target.value)}
                      />
                    </div>
                    <div className="flex-1 min-w-[150px]">
                      <Label className="text-xs text-muted-foreground mb-1 block">Data final</Label>
                      <Input 
                        type="date" 
                        value={filterDateTo}
                        onChange={(e) => setFilterDateTo(e.target.value)}
                      />
                    </div>
                    {(filterStatus !== 'all' || filterName || filterDateFrom || filterDateTo) && (
                      <div className="flex items-end">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => {
                            setFilterStatus('all');
                            setFilterName('');
                            setFilterDateFrom('');
                            setFilterDateTo('');
                          }}
                        >
                          Limpar filtros
                        </Button>
                      </div>
                    )}
                  </div>

                  {isLoadingReports ? (
                    <div className="flex justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                  ) : filteredReports.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      Nenhum report encontrado
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Usuário</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Imagem</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredReports.map((report) => (
                          <TableRow key={report.id}>
                            <TableCell className="whitespace-nowrap">
                              {report.created_at 
                                ? format(new Date(report.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
                                : '-'}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {report.user_name || 'Usuário desconhecido'}
                            </TableCell>
                            <TableCell className="max-w-md">
                              {report.description}
                            </TableCell>
                            <TableCell>
                              {report.screenshot_url ? (
                                <a 
                                  href={report.screenshot_url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline flex items-center gap-1"
                                >
                                  <ImageIcon className="h-4 w-4" />
                                  Ver
                                </a>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge 
                                variant={report.status === 'fixed' ? 'default' : 'secondary'}
                                className="cursor-pointer"
                                onClick={() => toggleStatus(report.id, report.status)}
                              >
                                {report.status === 'fixed' ? (
                                  <><CheckCircle className="h-3 w-3 mr-1" /> Corrigido</>
                                ) : (
                                  <><Clock className="h-3 w-3 mr-1" /> Pendente</>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button 
                                variant="ghost" 
                                size="icon"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => reportDelete.requestDelete(report.id)}
                                disabled={reportDelete.isDeleting}
                              >
                                {reportDelete.isDeleting && reportDelete.itemToDelete === report.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : (
          <ReportForm
            description={description}
            setDescription={setDescription}
            screenshot={screenshot}
            previewUrl={previewUrl}
            isHoveringUpload={isHoveringUpload}
            setIsHoveringUpload={setIsHoveringUpload}
            fileInputRef={fileInputRef}
            handleFileSelect={handleFileSelect}
            removeScreenshot={removeScreenshot}
            handleSubmit={handleSubmit}
            isSubmitting={isSubmitting}
          />
        )}
      </main>

      {/* Diálogo de confirmação - Excluir Bug Report */}
      <DeleteConfirmDialog
        open={reportDelete.isDialogOpen}
        onOpenChange={(open) => !open && reportDelete.cancelDelete()}
        onConfirm={reportDelete.confirmDelete}
        isDeleting={reportDelete.isDeleting}
        title="Excluir report?"
        description="Esta ação não pode ser desfeita. O report será permanentemente removido."
      />
    </div>
  );
}

interface ReportFormProps {
  description: string;
  setDescription: (value: string) => void;
  screenshot: File | null;
  previewUrl: string | null;
  isHoveringUpload: boolean;
  setIsHoveringUpload: (value: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  removeScreenshot: () => void;
  handleSubmit: () => void;
  isSubmitting: boolean;
}

function ReportForm({
  description,
  setDescription,
  screenshot,
  previewUrl,
  isHoveringUpload,
  setIsHoveringUpload,
  fileInputRef,
  handleFileSelect,
  removeScreenshot,
  handleSubmit,
  isSubmitting
}: ReportFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="h-5 w-5" />
          Reportar Problema
        </CardTitle>
        <CardDescription>
          Encontrou um bug? Descreva o problema e anexe uma imagem se necessário
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="description">Descrição do Problema</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descreva detalhadamente o problema encontrado..."
            rows={5}
          />
        </div>

        <div className="space-y-2">
          <Label>Captura de Tela (opcional)</Label>
          {previewUrl ? (
            <div className="relative inline-block">
              <img 
                src={previewUrl} 
                alt="Preview" 
                className="max-h-48 rounded-lg border border-border"
              />
              <Button
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={removeScreenshot}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all duration-300",
                isHoveringUpload 
                  ? "border-primary bg-primary/5 scale-[1.02]" 
                  : "border-border hover:border-primary/50"
              )}
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={() => setIsHoveringUpload(true)}
              onMouseLeave={() => setIsHoveringUpload(false)}
            >
              <Upload className={cn(
                "h-8 w-8 mx-auto mb-2 transition-transform duration-300",
                isHoveringUpload ? "scale-110 text-primary" : "text-muted-foreground"
              )} />
              <p className="text-sm text-muted-foreground">
                Clique para selecionar uma imagem
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                PNG, JPG até 5MB
              </p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        <Button 
          onClick={handleSubmit} 
          disabled={isSubmitting || !description.trim()}
          className="w-full"
        >
          {isSubmitting ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2"></div>
              Enviando...
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              Enviar Report
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
