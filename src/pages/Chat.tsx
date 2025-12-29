import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  conversation_id: string;
  created_at: string;
  feedback?: 'like' | 'dislike' | null;
  feedbackCounts?: { positive: number; negative: number };
  feedbackLoading?: boolean;
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
  const { toast } = useToast();
  
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) {
      fetchConversations();
    }
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
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', user?.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching conversations:', error);
      return;
    }

    setConversations(data.map(c => ({
      ...c,
      is_pinned: c.is_pinned || c.pinned || false
    })));
  };

  const fetchMessages = async (conversationId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching messages:', error);
      return;
    }

    setMessages(data.map(m => ({
      ...m,
      role: m.role as 'user' | 'assistant'
    })));
  };

  const handleNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
  };

  const handleSelectConversation = (id: string) => {
    setCurrentConversationId(id);
  };

  const handleDeleteConversation = async (id: string) => {
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível excluir a conversa',
      });
      return;
    }

    setConversations(prev => prev.filter(c => c.id !== id));
    if (currentConversationId === id) {
      setCurrentConversationId(null);
      setMessages([]);
    }
  };

  const handleRenameConversation = async (id: string, title: string) => {
    const { error } = await supabase
      .from('conversations')
      .update({ title })
      .eq('id', id);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível renomear a conversa',
      });
      return;
    }

    setConversations(prev => prev.map(c => 
      c.id === id ? { ...c, title } : c
    ));
  };

  const handlePinConversation = async (id: string, pinned: boolean) => {
    const { error } = await supabase
      .from('conversations')
      .update({ is_pinned: pinned, pinned: pinned })
      .eq('id', id);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível fixar a conversa',
      });
      return;
    }

    setConversations(prev => prev.map(c => 
      c.id === id ? { ...c, is_pinned: pinned } : c
    ));
  };

  const handleSendMessage = async (content: string) => {
    if (!user) return;

    setIsLoading(true);
    
    let conversationId = currentConversationId;

    // Create conversation if it doesn't exist
    if (!conversationId) {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          user_id: user.id,
          title: content.slice(0, 50) + (content.length > 50 ? '...' : ''),
        })
        .select()
        .single();

      if (convError) {
        toast({
          variant: 'destructive',
          title: 'Erro',
          description: 'Não foi possível criar a conversa',
        });
        setIsLoading(false);
        return;
      }

      conversationId = newConv.id;
      setCurrentConversationId(conversationId);
      setConversations(prev => [{
        ...newConv,
        is_pinned: false
      }, ...prev]);
    }

    // Add user message
    const { data: userMsg, error: userMsgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        content,
        role: 'user',
      })
      .select()
      .single();

    if (userMsgError) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível enviar a mensagem',
      });
      setIsLoading(false);
      return;
    }

    setMessages(prev => [...prev, { ...userMsg, role: 'user' as const }]);

    // Increment user points
    await supabase.rpc('increment_user_points', { p_user_id: user.id, p_points: 1 });

    // Log activity - usar 'message_sent' para o contador funcionar
    await supabase.from('activity_logs').insert({
      user_id: user.id,
      action: 'message_sent',
      details: { conversation_id: conversationId }
    });

    // Call n8n webhook
    try {
      const response = await fetch('https://n8n.vetorix.com.br/webhook-test/TkSolution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: content,
          user_id: user.id,
          conversation_id: conversationId,
        }),
      });

      let aiResponse = 'Desculpe, não consegui processar sua mensagem.';
      
      if (response.ok) {
        const data = await response.json();
        aiResponse = data.response || data.message || data.output || aiResponse;
      }

      // Add AI message
      const { data: aiMsg, error: aiMsgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          content: aiResponse,
          role: 'assistant',
        })
        .select()
        .single();

      if (!aiMsgError) {
        setMessages(prev => [...prev, { ...aiMsg, role: 'assistant' as const }]);
      }
    } catch (error) {
      console.error('Error calling webhook:', error);
      
      // Add error message
      const { data: errorMsg } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          content: 'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.',
          role: 'assistant',
        })
        .select()
        .single();

      if (errorMsg) {
        setMessages(prev => [...prev, { ...errorMsg, role: 'assistant' as const }]);
      }
    }

    // Update conversation timestamp
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    setIsLoading(false);
  };

  const handleFeedback = async (messageId: string, feedback: 'like' | 'dislike') => {
    // Find the AI message and the previous user message
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    const aiMessage = messages[messageIndex];
    
    // Find the previous user message
    let userMessage = '';
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessage = messages[i].content;
        break;
      }
    }

    // Set loading state
    setMessages(prev => prev.map(m => 
      m.id === messageId ? { ...m, feedbackLoading: true } : m
    ));

    try {
      // Call feedback webhook
      const response = await fetch('https://n8n.vetorix.com.br/webhook-test/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pergunta_original: userMessage,
          resposta_ia: aiMessage.content,
          voto: feedback === 'like' ? 'positivo' : 'negativo',
        }),
      });

      if (response.ok) {
        // Update message with feedback and increment counter
        setMessages(prev => prev.map(m => {
          if (m.id === messageId) {
            const currentCounts = m.feedbackCounts || { positive: 0, negative: 0 };
            return { 
              ...m, 
              feedback,
              feedbackLoading: false,
              feedbackCounts: {
                positive: currentCounts.positive + (feedback === 'like' ? 1 : 0),
                negative: currentCounts.negative + (feedback === 'dislike' ? 1 : 0),
              }
            };
          }
          return m;
        }));

        toast({
          title: 'Obrigado pelo feedback!',
        });
      } else {
        throw new Error('Webhook response not ok');
      }
    } catch (error) {
      console.error('Error sending feedback:', error);
      
      // Reset loading state
      setMessages(prev => prev.map(m => 
        m.id === messageId ? { ...m, feedbackLoading: false } : m
      ));

      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível enviar o feedback.',
      });
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      <div className="relative">
        <ChatSidebar
          conversations={conversations}
          currentConversationId={currentConversationId || undefined}
          onNewConversation={handleNewConversation}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          onRenameConversation={handleRenameConversation}
          onPinConversation={handlePinConversation}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b flex items-center justify-end px-4">
          <ThemeToggle />
        </header>

        <ScrollArea className="flex-1 p-4">
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-20">
                <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-bold mb-4">
                  TK
                </div>
                <h2 className="text-2xl font-semibold mb-2">Olá! Eu sou o Tkzinho</h2>
                <p className="text-muted-foreground max-w-md">
                  Estou aqui para ajudar você. Digite sua mensagem abaixo para começar uma conversa.
                </p>
              </div>
            ) : (
              messages.map((message, index) => {
                // Find previous user message for AI messages
                let previousUserMessage = '';
                if (message.role === 'assistant') {
                  for (let i = index - 1; i >= 0; i--) {
                    if (messages[i].role === 'user') {
                      previousUserMessage = messages[i].content;
                      break;
                    }
                  }
                }
                
                return (
                  <ChatMessage
                    key={message.id}
                    id={message.id}
                    content={message.content}
                    role={message.role}
                    userAvatar={profile?.avatar_url}
                    userName={profile?.full_name || profile?.email || 'Você'}
                    onFeedback={message.role === 'assistant' ? handleFeedback : undefined}
                    currentFeedback={message.feedback}
                    feedbackCounts={message.feedbackCounts}
                    feedbackLoading={message.feedbackLoading}
                    previousUserMessage={previousUserMessage}
                  />
                );
              })
            )}
            
            {isLoading && (
              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold shrink-0">
                  TK
                </div>
                <div className="bg-chat-ai rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1">
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

        <div className="p-4 border-t">
          <div className="max-w-3xl mx-auto">
            <ChatInput onSend={handleSendMessage} disabled={isLoading} />
          </div>
        </div>
      </div>
    </div>
  );
}
