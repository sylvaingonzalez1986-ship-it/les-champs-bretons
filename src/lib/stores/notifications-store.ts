import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Notifications Store - Manage push notifications to users
export type NotificationType = 'promo' | 'news' | 'event' | 'reminder' | 'general';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  scheduledAt?: string; // ISO date string for scheduled notifications
  sentAt?: string; // ISO date string when actually sent
  status: 'draft' | 'scheduled' | 'sent';
  targetAudience: 'all' | 'subscribers' | 'vip';
  createdAt: number;
}

export const NOTIFICATION_TYPE_CONFIG: Record<NotificationType, { label: string; color: string; icon: string }> = {
  promo: { label: 'Promotion', color: '#EF4444', icon: 'percent' },
  news: { label: 'Actualité', color: '#3B82F6', icon: 'newspaper' },
  event: { label: 'Événement', color: '#8B5CF6', icon: 'calendar' },
  reminder: { label: 'Rappel', color: '#F59E0B', icon: 'bell' },
  general: { label: 'Général', color: '#6B7280', icon: 'megaphone' },
};

interface NotificationsStore {
  notifications: AppNotification[];
  addNotification: (notification: Omit<AppNotification, 'id' | 'createdAt' | 'status' | 'sentAt'>) => void;
  updateNotification: (id: string, updates: Partial<AppNotification>) => void;
  deleteNotification: (id: string) => void;
  sendNotification: (id: string) => void;
  getScheduledNotifications: () => AppNotification[];
  getSentNotifications: () => AppNotification[];
  getDraftNotifications: () => AppNotification[];
}

export const useNotificationsStore = create<NotificationsStore>()(
  persist(
    (set, get) => ({
      notifications: [],

      addNotification: (notificationData) => {
        const newNotification: AppNotification = {
          ...notificationData,
          id: `notif-${Date.now()}`,
          status: notificationData.scheduledAt ? 'scheduled' : 'draft',
          createdAt: Date.now(),
        };
        set((state) => ({
          notifications: [newNotification, ...state.notifications],
        }));
      },

      updateNotification: (id, updates) => {
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, ...updates } : n
          ),
        }));
      },

      deleteNotification: (id) => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      },

      sendNotification: (id) => {
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, status: 'sent' as const, sentAt: new Date().toISOString() } : n
          ),
        }));
      },

      getScheduledNotifications: () => get().notifications.filter((n) => n.status === 'scheduled'),
      getSentNotifications: () => get().notifications.filter((n) => n.status === 'sent'),
      getDraftNotifications: () => get().notifications.filter((n) => n.status === 'draft'),
    }),
    {
      name: 'cbd-notifications-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
