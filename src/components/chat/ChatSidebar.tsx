import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Plus, 
  MessageSquare, 
  Pin, 
  Trash2, 
  Edit2, 
  Check, 
  X,
  ChevronLeft,
  ChevronRight,
  Settings,
  Shield,
  Bug,
  LogOut,
  MoreVertical
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Conversation {
  id: string;
  title: string;
  is_pinned: boolean;
  updated_at: string;
}

interface ChatSidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onPinConversation: (id: string, pinned: boolean) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function ChatSidebar({
  conversations,
  currentConversationId,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  onPinConversation,
  collapsed,
  onToggleCollapse,
}: ChatSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const { profile, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const pinnedConversations = conversations.filter(c => c.is_pinned);
  const unpinnedConversations = conversations.filter(c => !c.is_pinned);

  const handleStartEdit = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirmId) {
      onDeleteConversation(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const handleSaveEdit = (id: string) => {
    if (editTitle.trim()) {
      onRenameConversation(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const ConversationItem = ({ conv }: { conv: Conversation }) => {
    const isEditing = editingId === conv.id;
    const isActive = currentConversationId === conv.id;

    return (
      <div
        className={cn(
          'group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors',
          isActive ? 'bg-accent' : 'hover:bg-accent/50'
        )}
        onClick={() => !isEditing && onSelectConversation(conv.id)}
      >
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        
        {isEditing ? (
          <div className="flex-1 flex items-center gap-1 min-w-0">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value.substring(0, 30))}
              maxLength={30}
              className="h-6 text-sm"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit(conv.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                handleSaveEdit(conv.id);
              }}
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                setEditingId(null);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <>
            <span className="flex-1 min-w-0 truncate text-sm">
              {conv.title.length > 20 ? `${conv.title.substring(0, 20)}...` : conv.title}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0 hover:bg-muted"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onPinConversation(conv.id, !conv.is_pinned);
                  }}
                >
                  <Pin className={cn('h-4 w-4 mr-2', conv.is_pinned && 'fill-current')} />
                  {conv.is_pinned ? 'Desafixar' : 'Fixar'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartEdit(conv);
                  }}
                >
                  <Edit2 className="h-4 w-4 mr-2" />
                  Renomear
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirmId(conv.id);
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    );
  };

  if (collapsed) {
    return (
      <div className="h-full w-16 bg-sidebar border-r border-sidebar-border flex flex-col items-center py-4 transition-all duration-300 ease-in-out">
        <Logo size="sm" showText={false} className="mb-4" />
        
        <Button
          variant="ghost"
          size="icon"
          onClick={onNewConversation}
          className="mb-4"
        >
          <Plus className="h-5 w-5" />
        </Button>

        <div className="flex-1" />

        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/settings">
              <Settings className="h-5 w-5" />
            </Link>
          </Button>
          {isAdmin && (
            <Button variant="ghost" size="icon" asChild>
              <Link to="/admin">
                <Shield className="h-5 w-5" />
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="icon" asChild>
            <Link to="/bug-report">
              <Bug className="h-5 w-5" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" onClick={handleLogout}>
            <LogOut className="h-5 w-5" />
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="mt-4"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="h-full w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out">
      <div className="p-4 border-b border-sidebar-border">
        <Logo size="md" showText={true} />
      </div>

      <div className="p-3">
        <Button onClick={onNewConversation} className="w-full justify-start gap-2">
          <Plus className="h-4 w-4" />
          Nova Conversa
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3">
        {pinnedConversations.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-medium text-muted-foreground mb-2 px-3">Fixados</h3>
            {pinnedConversations.map(conv => (
              <ConversationItem key={conv.id} conv={conv} />
            ))}
          </div>
        )}

        {unpinnedConversations.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2 px-3">Histórico</h3>
            {unpinnedConversations.map(conv => (
              <ConversationItem key={conv.id} conv={conv} />
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="p-3 border-t border-sidebar-border">
        <div className="flex flex-col gap-1">
          <Button variant="ghost" className="w-full justify-start gap-2" asChild>
            <Link to="/settings">
              <Settings className="h-4 w-4" />
              Configurações
            </Link>
          </Button>
          {isAdmin && (
            <Button variant="ghost" className="w-full justify-start gap-2" asChild>
              <Link to="/admin">
                <Shield className="h-4 w-4" />
                Admin
              </Link>
            </Button>
          )}
          <Button variant="ghost" className="w-full justify-start gap-2" asChild>
            <Link to="/bug-report">
              <Bug className="h-4 w-4" />
              Reportar Bug
            </Link>
          </Button>
          <Button 
            variant="ghost" 
            className="w-full justify-start gap-2"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleCollapse}
        className="absolute top-4 -right-3 h-6 w-6 rounded-full bg-background border shadow-sm"
      >
        <ChevronLeft className="h-3 w-3" />
      </Button>
    </div>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A conversa será permanentemente removida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
