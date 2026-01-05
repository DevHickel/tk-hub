import { useState, useCallback } from 'react';
import { toast } from 'sonner';

interface DeleteState<T> {
  itemToDelete: T | null;
  isDeleting: boolean;
}

interface UseDeleteWithConfirmationOptions<T> {
  onDelete: (item: T) => Promise<void>;
  onSuccess?: () => void;
  successMessage?: string;
  errorMessage?: string;
}

export function useDeleteWithConfirmation<T>({
  onDelete,
  onSuccess,
  successMessage = 'Item excluído com sucesso',
  errorMessage = 'Erro ao excluir item',
}: UseDeleteWithConfirmationOptions<T>) {
  const [state, setState] = useState<DeleteState<T>>({
    itemToDelete: null,
    isDeleting: false,
  });

  const requestDelete = useCallback((item: T) => {
    setState({ itemToDelete: item, isDeleting: false });
  }, []);

  const cancelDelete = useCallback(() => {
    setState({ itemToDelete: null, isDeleting: false });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!state.itemToDelete) return;

    setState(prev => ({ ...prev, isDeleting: true }));

    try {
      await onDelete(state.itemToDelete);
      toast.success(successMessage);
      onSuccess?.();
      setState({ itemToDelete: null, isDeleting: false });
    } catch (error) {
      console.error('Delete error:', error);
      toast.error(errorMessage);
      setState(prev => ({ ...prev, isDeleting: false }));
    }
  }, [state.itemToDelete, onDelete, onSuccess, successMessage, errorMessage]);

  return {
    itemToDelete: state.itemToDelete,
    isDeleting: state.isDeleting,
    isDialogOpen: state.itemToDelete !== null,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}
