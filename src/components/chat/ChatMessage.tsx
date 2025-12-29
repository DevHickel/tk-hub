import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface ChatMessageProps {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  userAvatar?: string | null;
  userName?: string;
  onFeedback?: (messageId: string, feedback: 'like' | 'dislike') => void;
  currentFeedback?: 'like' | 'dislike' | null;
}

export function ChatMessage({ 
  id, 
  content, 
  role, 
  userAvatar, 
  userName,
  onFeedback,
  currentFeedback 
}: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div className={cn(
      'flex gap-3 animate-fade-in',
      isUser ? 'flex-row-reverse' : 'flex-row'
    )}>
      <Avatar className="h-8 w-8 shrink-0">
        {isUser ? (
          <>
            <AvatarImage src={userAvatar || undefined} />
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {userName?.charAt(0)?.toUpperCase() || 'U'}
            </AvatarFallback>
          </>
        ) : (
          <AvatarFallback className="bg-secondary text-secondary-foreground text-xs font-bold">
            TK
          </AvatarFallback>
        )}
      </Avatar>

      <div className={cn(
        'flex flex-col max-w-[75%]',
        isUser ? 'items-end' : 'items-start'
      )}>
        <span className="text-xs text-muted-foreground mb-1">
          {isUser ? userName || 'Você' : 'Tkzinho'}
        </span>
        
        <div className={cn(
          'rounded-2xl px-4 py-2.5',
          isUser 
            ? 'bg-chat-user text-chat-user-foreground rounded-tr-sm' 
            : 'bg-chat-ai text-chat-ai-foreground rounded-tl-sm'
        )}>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p>
        </div>

        {!isUser && onFeedback && (
          <div className="flex gap-1 mt-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6',
                currentFeedback === 'like' && 'text-green-500'
              )}
              onClick={() => onFeedback(id, 'like')}
            >
              <ThumbsUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6',
                currentFeedback === 'dislike' && 'text-red-500'
              )}
              onClick={() => onFeedback(id, 'dislike')}
            >
              <ThumbsDown className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
