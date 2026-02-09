import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CBDProduct } from '../types';

// Referral / Gift System - Send lots to friends and earn points
export interface GiftedLot {
  id: string;
  collectionItemId: string; // Reference to the original collection item
  product: CBDProduct;
  senderCode: string; // Unique code of the sender
  recipientCode: string | null; // Code of the recipient (null until claimed)
  giftCode: string; // Unique code to share with friend
  createdAt: number;
  claimedAt: number | null;
  used: boolean; // Whether the recipient has used the lot
}

interface ReferralStore {
  myCode: string; // User's unique referral code
  points: number; // Points earned from referrals
  giftsSent: GiftedLot[]; // Lots sent to friends
  giftsReceived: GiftedLot[]; // Lots received from friends
  // Actions
  generateMyCode: () => string;
  sendLotAsGift: (collectionItemId: string, product: CBDProduct) => string; // Returns gift code
  claimGift: (giftCode: string) => GiftedLot | null; // Claim a gift with code
  markGiftAsUsed: (giftId: string) => void; // Mark received gift as used (awards points to sender)
  addPoints: (amount: number) => void;
  getPointsHistory: () => { sent: number; pointsEarned: number };
  resetStore: () => void; // Reset pour changement d'utilisateur
}

const generateUniqueCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const useReferralStore = create<ReferralStore>()(
  persist(
    (set, get) => ({
      myCode: '',
      points: 0,
      giftsSent: [],
      giftsReceived: [],

      generateMyCode: () => {
        const state = get();
        if (state.myCode) return state.myCode;
        const newCode = generateUniqueCode();
        set({ myCode: newCode });
        return newCode;
      },

      sendLotAsGift: (collectionItemId: string, product: CBDProduct) => {
        const state = get();
        // Ensure user has a code
        const myCode = state.myCode || get().generateMyCode();

        const giftCode = `GIFT-${generateUniqueCode()}`;
        const newGift: GiftedLot = {
          id: `gift-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          collectionItemId,
          product,
          senderCode: myCode,
          recipientCode: null,
          giftCode,
          createdAt: Date.now(),
          claimedAt: null,
          used: false,
        };

        set((s) => ({
          giftsSent: [...s.giftsSent, newGift],
        }));

        return giftCode;
      },

      claimGift: (giftCode: string) => {
        const state = get();
        // Ensure user has a code
        const myCode = state.myCode || get().generateMyCode();

        // Find the gift in all users' sent gifts (simulated - in real app this would be server-side)
        // For now, we check our own sent gifts (for demo/testing)
        const gift = state.giftsSent.find(
          (g) => g.giftCode === giftCode && !g.recipientCode
        );

        if (gift) {
          // Update the gift as claimed
          const claimedGift: GiftedLot = {
            ...gift,
            recipientCode: myCode,
            claimedAt: Date.now(),
          };

          set((s) => ({
            giftsSent: s.giftsSent.map((g) =>
              g.id === gift.id ? claimedGift : g
            ),
            giftsReceived: [...s.giftsReceived, claimedGift],
          }));

          return claimedGift;
        }

        return null;
      },

      markGiftAsUsed: (giftId: string) => {
        const state = get();
        const gift = state.giftsReceived.find((g) => g.id === giftId);

        if (gift && !gift.used) {
          // Mark as used
          set((s) => ({
            giftsReceived: s.giftsReceived.map((g) =>
              g.id === giftId ? { ...g, used: true } : g
            ),
          }));

          // Award points to sender (10 points per used gift)
          // In a real app, this would be server-side
          set((s) => ({
            giftsSent: s.giftsSent.map((g) =>
              g.id === giftId ? { ...g, used: true } : g
            ),
          }));

          // Check if this is a gift we sent that was used
          const sentGift = state.giftsSent.find((g) => g.id === giftId);
          if (sentGift) {
            set((s) => ({ points: s.points + 10 }));
          }
        }
      },

      addPoints: (amount: number) =>
        set((s) => ({ points: s.points + amount })),

      getPointsHistory: () => {
        const state = get();
        const usedGifts = state.giftsSent.filter((g) => g.used);
        return {
          sent: state.giftsSent.length,
          pointsEarned: usedGifts.length * 10,
        };
      },

      resetStore: () =>
        set({
          myCode: '',
          points: 0,
          giftsSent: [],
          giftsReceived: [],
        }),
    }),
    {
      name: 'cbd-referral-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
