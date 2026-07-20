import type { StateCreator } from 'zustand';
import type { ConnectionSlice, RootState } from './types';

export const createConnectionSlice: StateCreator<RootState, [], [], ConnectionSlice> = (set) => ({
  connection: { status: 'connecting' },

  setConnectionStatus(status) {
    set({ connection: { status } });
  },
});
