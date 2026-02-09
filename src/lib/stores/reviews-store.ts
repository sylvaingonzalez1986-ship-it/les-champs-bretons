import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Product reviews store
export interface ProductReview {
  collectionItemId: string;
  rating: number; // 1-5 stars
  review: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ReviewsStore {
  reviews: Record<string, ProductReview>; // keyed by collectionItemId
  setReview: (collectionItemId: string, rating: number, review: string) => void;
  getReview: (collectionItemId: string) => ProductReview | undefined;
  deleteReview: (collectionItemId: string) => void;
}

export const useReviewsStore = create<ReviewsStore>()(
  persist(
    (set, get) => ({
      reviews: {},

      setReview: (collectionItemId: string, rating: number, review: string) =>
        set((state) => {
          const existing = state.reviews[collectionItemId];
          const now = new Date();
          return {
            reviews: {
              ...state.reviews,
              [collectionItemId]: {
                collectionItemId,
                rating,
                review,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
              },
            },
          };
        }),

      getReview: (collectionItemId: string) => {
        return get().reviews[collectionItemId];
      },

      deleteReview: (collectionItemId: string) =>
        set((state) => {
          const { [collectionItemId]: _, ...rest } = state.reviews;
          return { reviews: rest };
        }),
    }),
    {
      name: 'cbd-reviews-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
