import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Sound settings store
interface SoundStore {
  isMuted: boolean;
  toggleMute: () => void;
  setMuted: (muted: boolean) => void;
}

export const useSoundStore = create<SoundStore>()(
  persist(
    (set, get) => ({
      isMuted: false,
      toggleMute: () => set({ isMuted: !get().isMuted }),
      setMuted: (muted: boolean) => set({ isMuted: muted }),
    }),
    {
      name: 'cbd-sound-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
