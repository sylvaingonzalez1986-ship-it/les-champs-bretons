import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Customer Info Store - for order validation
export interface CustomerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
}

interface CustomerInfoStore {
  customerInfo: CustomerInfo;
  setCustomerInfo: (info: Partial<CustomerInfo>) => void;
  clearCustomerInfo: () => void;
  isProfileComplete: () => boolean;
  getMissingFields: () => string[];
}

const initialCustomerInfo: CustomerInfo = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  postalCode: '',
};

export const useCustomerInfoStore = create<CustomerInfoStore>()(
  persist(
    (set, get) => ({
      customerInfo: initialCustomerInfo,

      setCustomerInfo: (info: Partial<CustomerInfo>) =>
        set((state) => ({
          customerInfo: { ...state.customerInfo, ...info },
        })),

      clearCustomerInfo: () =>
        set({ customerInfo: initialCustomerInfo }),

      isProfileComplete: () => {
        const info = get().customerInfo;
        return !!(
          info.firstName.trim() &&
          info.lastName.trim() &&
          info.email.trim() &&
          info.phone.trim() &&
          info.address.trim() &&
          info.city.trim() &&
          info.postalCode.trim()
        );
      },

      getMissingFields: () => {
        const info = get().customerInfo;
        const missingFields: string[] = [];

        const fieldLabels: Record<keyof CustomerInfo, string> = {
          firstName: 'Prénom',
          lastName: 'Nom',
          email: 'Email',
          phone: 'Téléphone',
          address: 'Adresse',
          city: 'Ville',
          postalCode: 'Code postal',
        };

        (Object.keys(fieldLabels) as Array<keyof CustomerInfo>).forEach((key) => {
          if (!info[key]?.trim()) {
            missingFields.push(fieldLabels[key]);
          }
        });

        return missingFields;
      },
    }),
    {
      name: 'cbd-customer-info-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
