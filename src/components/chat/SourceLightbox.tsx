import * as DialogPrimitive from '@radix-ui/react-dialog';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SourceLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  label?: string;
  caption: string;
}

export function SourceLightbox({ open, onOpenChange, src, label, caption }: SourceLightboxProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-background/70 backdrop-blur-md',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[min(96vw,1200px)] h-[min(92vh,900px)]',
            '-translate-x-1/2 -translate-y-1/2',
            'bg-background/95 border border-border rounded-xl shadow-2xl overflow-hidden',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {label ?? caption}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Visualização ampliada da fonte. Use a roda do mouse para zoom, arraste para mover.
          </DialogPrimitive.Description>

          <TransformWrapper
            minScale={1}
            maxScale={8}
            initialScale={1}
            wheel={{ step: 0.25 }}
            doubleClick={{ mode: 'toggle', step: 2 }}
            pinch={{ step: 5 }}
            centerOnInit
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <div className="absolute top-3 right-3 z-10 flex gap-1">
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 shadow-sm"
                    onClick={() => zoomIn()}
                    aria-label="Aumentar zoom"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 shadow-sm"
                    onClick={() => zoomOut()}
                    aria-label="Diminuir zoom"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 shadow-sm"
                    onClick={() => resetTransform()}
                    aria-label="Resetar zoom"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <DialogPrimitive.Close asChild>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-8 w-8 shadow-sm"
                      aria-label="Fechar"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </DialogPrimitive.Close>
                </div>

                <TransformComponent
                  wrapperClass="!w-full !h-full"
                  contentClass="!w-full !h-full flex items-center justify-center"
                >
                  <img
                    src={src}
                    alt={label ?? caption}
                    className="max-w-full max-h-full object-contain select-none"
                    draggable={false}
                  />
                </TransformComponent>

                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[90%] pointer-events-none">
                  <div className="text-xs text-muted-foreground bg-background/85 backdrop-blur-sm rounded-md px-3 py-1.5 border border-border/60 shadow-sm text-center">
                    {label ? (
                      <>
                        <span className="font-medium text-foreground">{label}</span>
                        <span className="mx-2 opacity-50">·</span>
                        {caption}
                      </>
                    ) : (
                      caption
                    )}
                  </div>
                </div>
              </>
            )}
          </TransformWrapper>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
