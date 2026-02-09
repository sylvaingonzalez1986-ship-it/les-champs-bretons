import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ProducerProduct, Producer, SAMPLE_PRODUCERS } from '../producers';

interface ProducerStore {
  producers: Producer[];
  addProducer: (producer: Producer) => void;
  updateProducer: (id: string, producer: Partial<Producer>) => void;
  removeProducer: (id: string) => void;
  addProductToProducer: (producerId: string, product: ProducerProduct) => void;
  updateProductInProducer: (producerId: string, product: ProducerProduct) => void;
  removeProductFromProducer: (producerId: string, productId: string) => void;
  decrementProductStock: (producerId: string, productId: string, quantity: number) => boolean;
}

export const useProducerStore = create<ProducerStore>()(
  persist(
    (set, get) => ({
      producers: [],
      addProducer: (producer: Producer) =>
        set((state) => ({
          producers: [...state.producers, producer],
        })),
      updateProducer: (id: string, producer: Partial<Producer>) =>
        set((state) => ({
          producers: state.producers.map((p) =>
            p.id === id ? { ...p, ...producer } : p
          ),
        })),
      removeProducer: (id: string) =>
        set((state) => ({
          producers: state.producers.filter((p) => p.id !== id),
        })),
      addProductToProducer: (producerId: string, product: ProducerProduct) =>
        set((state) => {
          // Check if producer exists in custom producers
          const existingProducer = state.producers.find((p) => p.id === producerId);
          if (existingProducer) {
            // Add to existing custom producer
            return {
              producers: state.producers.map((p) =>
                p.id === producerId
                  ? { ...p, products: [...p.products, product] }
                  : p
              ),
            };
          }

          // Check if it's a sample producer - if so, clone it to custom producers
          const sampleProducer = SAMPLE_PRODUCERS.find((p) => p.id === producerId);
          if (sampleProducer) {
            const clonedProducer = {
              ...sampleProducer,
              products: [...sampleProducer.products, product],
            };
            return {
              producers: [...state.producers, clonedProducer],
            };
          }

          return state;
        }),
      updateProductInProducer: (producerId: string, product: ProducerProduct) =>
        set((state) => {
          // Check if producer exists in custom producers
          const existingProducer = state.producers.find((p) => p.id === producerId);

          if (existingProducer) {
            // Check if product exists in this custom producer
            const productExistsInCustom = existingProducer.products.some((p) => p.id === product.id);

            if (productExistsInCustom) {
              // Update existing product in custom producer
              return {
                producers: state.producers.map((p) =>
                  p.id === producerId
                    ? { ...p, products: p.products.map((prod) => prod.id === product.id ? product : prod) }
                    : p
                ),
              };
            }

            // Product doesn't exist in custom producer - check if it's a sample product
            const sampleProducer = SAMPLE_PRODUCERS.find((sp) => sp.id === producerId);
            const isSampleProduct = sampleProducer?.products.some((sp) => sp.id === product.id);

            if (isSampleProduct && sampleProducer) {
              // Need to merge sample products into custom producer
              // Start with all sample products (updating the modified one)
              const sampleProductsUpdated = sampleProducer.products.map((sp) =>
                sp.id === product.id ? product : sp
              );

              // Get custom-only products (products added by user, not in sample)
              const customOnlyProducts = existingProducer.products.filter(
                (cp) => !sampleProducer.products.some((sp) => sp.id === cp.id)
              );

              // Combine: sample products + custom-only products
              return {
                producers: state.producers.map((p) =>
                  p.id === producerId
                    ? { ...p, products: [...sampleProductsUpdated, ...customOnlyProducts] }
                    : p
                ),
              };
            }

            // Not a sample product, just add it
            return {
              producers: state.producers.map((p) =>
                p.id === producerId
                  ? { ...p, products: [...p.products, product] }
                  : p
              ),
            };
          }

          // Producer doesn't exist in custom - check if it's a sample producer
          const sampleProducer = SAMPLE_PRODUCERS.find((p) => p.id === producerId);
          if (sampleProducer) {
            // Clone the sample producer with ALL products, but update the modified one
            const clonedProducer: Producer = {
              ...sampleProducer,
              products: sampleProducer.products.map((prod) =>
                prod.id === product.id ? product : prod
              ),
            };
            return {
              producers: [...state.producers, clonedProducer],
            };
          }

          return state;
        }),
      removeProductFromProducer: (producerId: string, productId: string) =>
        set((state) => ({
          producers: state.producers.map((p) =>
            p.id === producerId
              ? { ...p, products: p.products.filter((prod) => prod.id !== productId) }
              : p
          ),
        })),
      decrementProductStock: (producerId: string, productId: string, quantity: number) => {
        let success = false;
        set((state) => {
          const producer = state.producers.find((p) => p.id === producerId);
          if (!producer) return state;

          const product = producer.products.find((p) => p.id === productId);
          if (!product || product.stock === undefined) return state;
          if (product.stock < quantity) return state;

          success = true;
          return {
            producers: state.producers.map((p) =>
              p.id === producerId
                ? {
                    ...p,
                    products: p.products.map((prod) =>
                      prod.id === productId
                        ? { ...prod, stock: (prod.stock ?? 0) - quantity }
                        : prod
                    ),
                  }
                : p
            ),
          };
        });
        return success;
      },
    }),
    {
      name: 'cbd-producers-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
