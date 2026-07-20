import type { StateCreator } from 'zustand';
import type { ChatSlice, RootState } from './types';

export const createChatSlice: StateCreator<RootState, [], [], ChatSlice> = (set) => {
  // Closed over per store instance (not module-level) so each `createRootStore()` call — every
  // test gets its own — starts its own id sequence at 1 instead of sharing one across instances.
  let seq = 0;

  return {
    chat: { messages: [] },

    addChatMessage(payload) {
      seq += 1;
      const id = seq;
      set((state) => ({ chat: { messages: [...state.chat.messages, { id, ...payload }] } }));
    },
  };
};
