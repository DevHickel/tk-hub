import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import tkzinhoAvatar from '@/assets/tkzinho.jpg';

interface ChatMessageProps {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  userAvatar?: string | null;
  userName?: string;
  onFeedback?: (messageId: string, feedback: 'like' | 'dislike') => Promise<void>;
  currentFeedback?: 'like' | 'dislike' | null;
  feedbackCounts?: { positive: number; negative: number };
  feedbackLoading?: boolean;
  previousUserMessage?: string;
}

export function ChatMessage({ 
  id, 
  content, 
  role, 
  userAvatar, 
  userName,
  onFeedback,
  currentFeedback,
  feedbackCounts,
  feedbackLoading = false,
  previousUserMessage
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
          <AvatarImage src={tkzinhoAvatar} alt="Tkzinho" className="object-cover" />
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
          <div className="flex items-center gap-2 mt-1">
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-6 w-6',
                  currentFeedback === 'like' && 'text-green-500 bg-green-500/10'
                )}
                onClick={() => onFeedback(id, 'like')}
                disabled={currentFeedback === 'like' || feedbackLoading}
              >
                <ThumbsUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-6 w-6',
                  currentFeedback === 'dislike' && 'text-red-500 bg-red-500/10'
                )}
                onClick={() => onFeedback(id, 'dislike')}
                disabled={currentFeedback === 'dislike' || feedbackLoading}
              >
                <ThumbsDown className="h-3 w-3" />
              </Button>
            </div>
            {feedbackCounts && (
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-0.5">
                  <ThumbsUp className="h-3 w-3 text-green-500" />
                  {feedbackCounts.positive}
                </span>
                <span className="flex items-center gap-0.5">
                  <ThumbsDown className="h-3 w-3 text-red-500" />
                  {feedbackCounts.negative}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
