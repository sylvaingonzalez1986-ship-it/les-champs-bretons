import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Legacy Producer reviews store - kept for backward compatibility
export interface ProducerReview {
  id: string;
  producerId: string;
  rating: number; // 1-5 stars
  comment: string;
  userName: string;
  createdAt: number;
}

interface ProducerReviewsStore {
  reviews: ProducerReview[];
  addReview: (producerId: string, rating: number, comment: string, userName?: string) => void;
  getReviewsForProducer: (producerId: string) => ProducerReview[];
  getAverageRating: (producerId: string) => number;
  deleteReview: (reviewId: string) => void;
}

export const useProducerReviewsStore = create<ProducerReviewsStore>()(
  persist(
    (set, get) => ({
      reviews: [],

      addReview: (producerId: string, rating: number, comment: string, userName?: string) =>
        set((state) => ({
          reviews: [
            ...state.reviews,
            {
              id: `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              producerId,
              rating,
              comment,
              userName: userName || 'Anonyme',
              createdAt: Date.now(),
            },
          ],
        })),

      getReviewsForProducer: (producerId: string) => {
        return get().reviews.filter((r) => r.producerId === producerId);
      },

      getAverageRating: (producerId: string) => {
        const producerReviews = get().reviews.filter((r) => r.producerId === producerId);
        if (producerReviews.length === 0) return 0;
        const total = producerReviews.reduce((sum, r) => sum + r.rating, 0);
        return total / producerReviews.length;
      },

      deleteReview: (reviewId: string) =>
        set((state) => ({
          reviews: state.reviews.filter((r) => r.id !== reviewId),
        })),
    }),
    {
      name: 'cbd-producer-reviews-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
