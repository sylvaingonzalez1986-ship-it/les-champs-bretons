import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui';
import { usePermissions } from '@/lib/useAuth';
import GestionCommandesScreen from '../gestion-commandes';

type GestionMode = 'producer' | 'pro' | 'admin';

export default function GestionTabScreen() {
  const router = useRouter();
  const { isProducer, isPro, isAdmin } = usePermissions();

  const mode: GestionMode | null = isProducer
    ? 'producer'
    : isPro
      ? 'pro'
      : isAdmin
        ? 'admin'
        : null;

  useEffect(() => {
    if (!mode) {
      router.replace('/(tabs)/profile');
    }
  }, [mode, router]);

  if (!mode) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <Text className="text-gray-400 text-sm">Acces reserve</Text>
      </View>
    );
  }

  return <GestionCommandesScreen mode={mode} />;
}
