import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import tkzinhoAvatar from '@/assets/tkzinho.jpg';
import { logActivity } from '@/lib/activity';
import {
  Plus,
  Send,
  Trash2,
  Pin,
  PinOff,
  Pencil,
  MoreHorizontal,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SourceLightbox } from '@/components/chat/SourceLightbox';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface MessageSource {
  file_name: string;
  page: number;
  image_url: string;
  label?: string;
}

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  conversation_id: string;
  created_at: string;
  feedback?: 'like' | 'dislike' | null;
  chat_history_id?: string | null;
  sources?: MessageSource[] | null;
}

interface Conversation {
  id: string;
  title: string;
  is_pinned: boolean;
  updated_at: string;
}

export default function Chat() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [lightbox, setLightbox] = useState<{ msgId: string; idx: number } | null>(null);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar, collapse: collapseSidebar } = useSidebarCollapsed(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loading && !user) navigate('/login');
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) fetchConversations();
  }, [user]);

  useEffect(() => {
    if (currentConversationId) {
      fetchMessages(currentConversationId);
    } else {
      setMessages([]);
    }
  }, [currentConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversations = async () => {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', user?.id)
      .order('updated_at', { ascending: false });
    if (data) setConversations(data.map(c => ({ ...c, is_pinned: c.is_pinned || false })));
  };

  const fetchMessages = async (conversationId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data.map(m => ({
      ...m,
      role: m.role as 'user' | 'assistant',
      sources: (m.sources as unknown as MessageSource[] | null) ?? null,
    })));
  };

  const handleNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
    inputRef.current?.focus();
  };

  const handleDeleteConversation = async (id: string) => {
    await supabase.from('conversations').delete().eq('id', id);
    setConversations(prev => prev.filter(c => c.id !== id));
    if (currentConversationId === id) {
      setCurrentConversationId(null);
      setMessages([]);
    }
  };

  const handlePinConversation = async (id: string, pinned: boolean) => {
    await supabase.from('conversations').update({ is_pinned: pinned }).eq('id', id);
    setConversations(prev => prev.map(c => c.id === id ? { ...c, is_pinned: pinned } : c));
  };

  const handleRenameSubmit = async (id: string) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    await supabase.from('conversations').update({ title: renameValue.trim() }).eq('id', id);
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title: renameValue.trim() } : c));
    setRenamingId(null);
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || isLoading || !user) return;
    setInput('');
    setIsLoading(true);

    let conversationId = currentConversationId;

    if (!conversationId) {
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({ user_id: user.id, title: content.slice(0, 50) + (content.length > 50 ? '...' : '') })
        .select()
        .single();
      if (!newConv) { setIsLoading(false); return; }
      conversationId = newConv.id;
      setCurrentConversationId(conversationId);
      setConversations(prev => [{ ...newConv, is_pinned: false }, ...prev]);
    }

    const { data: userMsg } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, content, role: 'user' })
      .select()
      .single();
    if (userMsg) setMessages(prev => [...prev, { ...userMsg, role: 'user' as const, sources: null } as Message]);

    await logActivity(user.id, 'message_sent', { conversation_id: conversationId });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ message: content, conversation_id: conversationId }),
      });

      let aiResponse = 'Desculpe, não consegui processar sua mensagem.';
      let chatHistoryId: string | null = null;
      let sources: MessageSource[] = [];
      if (response.ok) {
        const data = await response.json();
        aiResponse = data.response || aiResponse;
        chatHistoryId = data.chat_history_id ?? null;
        sources = Array.isArray(data.sources) ? data.sources : [];
      } else {
        const errBody = await response.json().catch(() => ({}));
        const errMsg = (errBody as { error?: string }).error ?? `HTTP ${response.status}`;
        console.error('[chat] /api/chat falhou:', response.status, errBody);
        aiResponse = `Erro: ${errMsg} (status ${response.status})`;
      }

      const { data: aiMsg } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          content: aiResponse,
          role: 'assistant',
          chat_history_id: chatHistoryId,
          sources: (sources.length > 0 ? sources : null) as never,
        })
        .select()
        .single();
      if (aiMsg) setMessages(prev => [...prev, {
        ...aiMsg,
        role: 'assistant' as const,
        sources: (aiMsg.sources as unknown as MessageSource[] | null) ?? null,
      } as Message]);
    } catch {
      const { data: errMsg } = await supabase
        .from('messages')
        .insert({ conversation_id: conversationId, content: 'Erro ao processar sua mensagem. Tente novamente.', role: 'assistant' })
        .select()
        .single();
      if (errMsg) setMessages(prev => [...prev, { ...errMsg, role: 'assistant' as const, sources: null } as Message]);
    }

    await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
    setIsLoading(false);
  };

  const handleFeedback = async (messageId: string, feedback: 'like' | 'dislike') => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    if (!msg.chat_history_id) {
      toast.error('Esta resposta não pode ser avaliada (dados de treinamento ausentes).');
      return;
    }
    if (!user) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const apiUrl = import.meta.env.VITE_API_URL;
      const res = await fetch(`${apiUrl}/api/chat/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ chat_history_id: msg.chat_history_id, feedback }),
      });

      if (!res.ok) throw new Error(`feedback ${res.status}`);

      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, feedback } : m));
      await logActivity(
        user.id,
        feedback === 'like' ? 'message_feedback_positive' : 'message_feedback_negative',
        { chat_history_id: msg.chat_history_id },
      );
      toast.success('Obrigado pelo feedback! A IA vai aprender com isso.');
    } catch {
      toast.error('Não foi possível salvar o feedback.');
    }
  };

  const pinnedConvs = conversations.filter(c => c.is_pinned);
  const unpinnedConvs = conversations.filter(c => !c.is_pinned);

  const getInitials = (name: string | null) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AppSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} onCollapse={collapseSidebar} />

      {/* Conversations panel */}
      <div className="flex-[0_0_240px] border-r bg-card flex flex-col overflow-hidden">
        <div className="p-3 border-b">
          <Button className="w-full gap-2" onClick={handleNewConversation}>
            <Plus className="h-4 w-4" />
            Nova Conversa
          </Button>
        </div>

        <ScrollArea className="flex-1 [&>div>div]:!overflow-x-hidden">
          <div className="p-2 space-y-1 overflow-hidden">
            {pinnedConvs.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground px-2 py-1 font-medium">Fixadas</p>
                {pinnedConvs.map(conv => (
                  <ConvItem
                    key={conv.id}
                    conv={conv}
                    active={currentConversationId === conv.id}
                    renamingId={renamingId}
                    renameValue={renameValue}
                    onSelect={() => setCurrentConversationId(conv.id)}
                    onRenameStart={() => { setRenamingId(conv.id); setRenameValue(conv.title); }}
                    onRenameChange={setRenameValue}
                    onRenameSubmit={() => handleRenameSubmit(conv.id)}
                    onPin={() => handlePinConversation(conv.id, !conv.is_pinned)}
                    onDelete={() => handleDeleteConversation(conv.id)}
                  />
                ))}
                <div className="border-t my-1" />
              </>
            )}
            {unpinnedConvs.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground px-2 py-1 font-medium">Histórico</p>
                {unpinnedConvs.map(conv => (
                  <ConvItem
                    key={conv.id}
                    conv={conv}
                    active={currentConversationId === conv.id}
                    renamingId={renamingId}
                    renameValue={renameValue}
                    onSelect={() => setCurrentConversationId(conv.id)}
                    onRenameStart={() => { setRenamingId(conv.id); setRenameValue(conv.title); }}
                    onRenameChange={setRenameValue}
                    onRenameSubmit={() => handleRenameSubmit(conv.id)}
                    onPin={() => handlePinConversation(conv.id, !conv.is_pinned)}
                    onDelete={() => handleDeleteConversation(conv.id)}
                  />
                ))}
              </>
            )}
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8 px-4">
                Nenhuma conversa ainda. Comece digitando uma mensagem!
              </p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b bg-card flex items-center justify-between px-6 shrink-0">
          <div>
            <h1 className="text-lg font-semibold">Assistente IA</h1>
            <p className="text-xs text-muted-foreground">Tkzinho — powered by IA</p>
          </div>
          <ThemeToggle />
        </header>

        <ScrollArea className="flex-1">
          <div className="max-w-3xl mx-auto p-6 space-y-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-24">
                <img src={tkzinhoAvatar} alt="Tkzinho" className="h-20 w-20 rounded-full object-cover mb-4 shadow-md" />
                <h2 className="text-2xl font-semibold mb-2">Olá! Eu sou o Tkzinho</h2>
                <p className="text-muted-foreground max-w-md">
                  Estou aqui para ajudar você. Digite sua mensagem abaixo para começar uma conversa.
                </p>
              </div>
            ) : (
              messages.map((message) => {
                const isUser = message.role === 'user';
                return (
                  <div key={message.id} className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
                    {isUser ? (
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={profile?.avatar_url || undefined} />
                        <AvatarFallback className="text-xs">{getInitials(profile?.full_name || null)}</AvatarFallback>
                      </Avatar>
                    ) : (
                      <img src={tkzinhoAvatar} alt="Tkzinho" className="h-8 w-8 rounded-full object-cover shrink-0" />
                    )}
                    <div className={cn('flex flex-col gap-1 max-w-[75%]', isUser ? 'items-end' : 'items-start')}>
                      <div
                        className={cn(
                          'rounded-2xl px-4 py-3 text-sm leading-relaxed',
                          isUser
                            ? 'bg-[#004C97] text-white rounded-tr-sm'
                            : 'bg-muted rounded-tl-sm'
                        )}
                      >
                        {isUser ? (
                          <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        ) : (
                          <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-headings:my-2 prose-table:my-2 prose-hr:my-2 prose-strong:text-foreground prose-code:text-foreground">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                          </div>
                        )}
                        {!isUser && message.sources && message.sources.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-border/40">
                            <p className="text-xs text-muted-foreground mb-2">📎 Fonte visual — clique para ampliar</p>
                            <div className="flex flex-wrap gap-3">
                              {message.sources.map((s, i) => (
                                <div key={i} className="flex flex-col items-start gap-1 max-w-[130px]">
                                  <button
                                    type="button"
                                    className="cursor-zoom-in rounded border border-border overflow-hidden bg-white hover:ring-2 hover:ring-primary/40 transition-shadow"
                                    onClick={() => setLightbox({ msgId: message.id, idx: i })}
                                  >
                                    <img
                                      src={s.image_url}
                                      alt={s.label ?? `${s.file_name} — página ${s.page}`}
                                      className="max-h-24 w-auto object-contain"
                                    />
                                  </button>
                                  <SourceLightbox
                                    open={lightbox?.msgId === message.id && lightbox?.idx === i}
                                    onOpenChange={(open) => { if (!open) setLightbox(null); }}
                                    src={s.image_url}
                                    label={s.label}
                                    caption={`${s.file_name} · Pág. ${s.page}`}
                                  />
                                  <span
                                    className="text-[10px] text-muted-foreground leading-tight"
                                    title={`${s.file_name} — Pág. ${s.page}`}
                                  >
                                    {s.label ? `${s.label} · Pág. ${s.page}` : `Pág. ${s.page}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      {!isUser && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <button
                            onClick={() => handleFeedback(message.id, 'like')}
                            className={cn('p-1 rounded hover:bg-muted transition-colors', message.feedback === 'like' && 'text-green-500')}
                          >
                            <ThumbsUp className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleFeedback(message.id, 'dislike')}
                            className={cn('p-1 rounded hover:bg-muted transition-colors', message.feedback === 'dislike' && 'text-red-500')}
                          >
                            <ThumbsDown className="h-3 w-3" />
                          </button>
                          {message.created_at && (
                            <span className="text-xs text-muted-foreground ml-1">
                              {formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: ptBR })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {isLoading && (
              <div className="flex gap-3">
                <img src={tkzinhoAvatar} alt="Tkzinho" className="h-8 w-8 rounded-full object-cover shrink-0" />
                <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1 items-center h-5">
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="p-4 border-t bg-card shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Digite sua mensagem... (Enter para enviar, Shift+Enter para nova linha)"
                rows={1}
                disabled={isLoading}
                className="flex-1 resize-none rounded-xl border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#004C97]/50 disabled:opacity-50 min-h-[48px] max-h-[200px]"
                style={{ height: 'auto' }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
                }}
              />
              <Button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="h-12 w-12 rounded-xl bg-[#004C97] hover:bg-[#003a75] shrink-0"
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConvItem({
  conv,
  active,
  renamingId,
  renameValue,
  onSelect,
  onRenameStart,
  onRenameChange,
  onRenameSubmit,
  onPin,
  onDelete,
}: {
  conv: Conversation;
  active: boolean;
  renamingId: string | null;
  renameValue: string;
  onSelect: () => void;
  onRenameStart: () => void;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer text-sm transition-colors min-w-0',
        active ? 'bg-[#004C97]/10 text-[#004C97] dark:text-blue-400' : 'hover:bg-muted'
      )}
      onClick={onSelect}
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
      {renamingId === conv.id ? (
        <Input
          autoFocus
          value={renameValue}
          onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={e => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameChange(''); }}
          className="h-6 text-xs px-1 py-0 min-w-0 flex-1"
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs">
          {conv.title.length > 25 ? conv.title.slice(0, 25) + '...' : conv.title}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
          <button className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted-foreground/20 transition-opacity">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={e => { e.stopPropagation(); onRenameStart(); }}>
            <Pencil className="h-3.5 w-3.5 mr-2" />Renomear
          </DropdownMenuItem>
          <DropdownMenuItem onClick={e => { e.stopPropagation(); onPin(); }}>
            {conv.is_pinned ? (
              <><PinOff className="h-3.5 w-3.5 mr-2" />Desafixar</>
            ) : (
              <><Pin className="h-3.5 w-3.5 mr-2" />Fixar</>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
