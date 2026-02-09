import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Product reviews store (reviews per product, not per producer)
export interface ProductReviewItem {
  id: string;
  productId: string;
  producerId: string;
  rating: number; // 1-5 stars
  comment: string;
  userName: string;
  createdAt: number;
}

interface ProductReviewsStore {
  reviews: ProductReviewItem[];
  addReview: (productId: string, producerId: string, rating: number, comment: string, userName?: string) => void;
  getReviewsForProduct: (productId: string) => ProductReviewItem[];
  getAverageRatingForProduct: (productId: string) => number;
  getReviewsForProducer: (producerId: string) => ProductReviewItem[];
  getAverageRatingForProducer: (producerId: string) => number;
  deleteReview: (reviewId: string) => void;
}

export const useProductReviewsStore = create<ProductReviewsStore>()(
  persist(
    (set, get) => ({
      reviews: [],

      addReview: (productId: string, producerId: string, rating: number, comment: string, userName?: string) =>
        set((state) => ({
          reviews: [
            ...state.reviews,
            {
              id: `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              productId,
              producerId,
              rating,
              comment,
              userName: userName || 'Anonyme',
              createdAt: Date.now(),
            },
          ],
        })),

      getReviewsForProduct: (productId: string) => {
        return get().reviews.filter((r) => r.productId === productId);
      },

      getAverageRatingForProduct: (productId: string) => {
        const productReviews = get().reviews.filter((r) => r.productId === productId);
        if (productReviews.length === 0) return 0;
        const total = productReviews.reduce((sum, r) => sum + r.rating, 0);
        return total / productReviews.length;
      },

      getReviewsForProducer: (producerId: string) => {
        return get().reviews.filter((r) => r.producerId === producerId);
      },

      getAverageRatingForProducer: (producerId: string) => {
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
      name: 'cbd-product-reviews-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
