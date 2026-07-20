import type { StateCreator } from 'zustand';
import type { RootState, ToastSlice } from './types';

export const createToastSlice: StateCreator<RootState, [], [], ToastSlice> = (set) => {
  // Per store instance, see chatSlice.ts's `seq` for why this isn't module-level.
  let seq = 0;

  return {
    toasts: [],

    pushToast(input) {
      seq += 1;
      const id = seq;
      set((state) => ({ toasts: [...state.toasts, { id, ...input }] }));
    },

    dismissToast(id) {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
  };
};
