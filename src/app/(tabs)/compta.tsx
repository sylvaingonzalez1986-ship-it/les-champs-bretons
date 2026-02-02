/**
 * Onglet Comptabilité
 * Version simplifiée - lien vers application externe
 */

import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrendingUp, ExternalLink, Lock } from 'lucide-react-native';
import { useAuth } from '@/lib/useAuth';

export default function ComptaScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const isPro = profile?.role === 'pro';

  return (
    <ScrollView className="flex-1 bg-gray-50">
      {/* Header */}
      <View
        className="bg-gradient-to-br from-indigo-600 to-purple-600 px-6 pb-8"
        style={{ paddingTop: insets.top + 16 }}
      >
        <Text className="text-3xl font-bold text-white">Comptabilité</Text>
        <Text className="mt-2 text-indigo-100">Gestion de vos finances</Text>
      </View>

      {/* Content */}
      <View className="px-4 -mt-6">
        {isPro ? (
          <View className="bg-white rounded-2xl shadow-lg p-6">
            <View className="items-center mb-6">
              <View className="bg-indigo-100 rounded-full p-4 mb-4">
                <TrendingUp size={48} color="#667eea" />
              </View>
              <Text className="text-xl font-bold text-gray-900 text-center">
                Application Comptabilité
              </Text>
              <Text className="mt-2 text-sm text-gray-600 text-center">
                Gérez vos revenus, commissions et transactions
              </Text>
            </View>

            <View className="bg-gray-50 rounded-xl p-4 mb-6">
              <Text className="text-sm text-gray-700 mb-2">
                <Text className="font-semibold">• </Text>Suivi des revenus en temps réel
              </Text>
              <Text className="text-sm text-gray-700 mb-2">
                <Text className="font-semibold">• </Text>Historique des transactions
              </Text>
              <Text className="text-sm text-gray-700 mb-2">
                <Text className="font-semibold">• </Text>Calcul automatique des commissions
              </Text>
              <Text className="text-sm text-gray-700">
                <Text className="font-semibold">• </Text>Exports et rapports détaillés
              </Text>
            </View>

            {/* Bouton pour accéder à l'app externe (à activer plus tard) */}
            <Pressable
              disabled
              className="bg-gray-300 rounded-xl py-4 px-6 flex-row items-center justify-center"
            >
              <ExternalLink size={20} color="#6B7280" />
              <Text className="ml-2 text-gray-600 font-semibold">
                Bientôt disponible
              </Text>
            </Pressable>

            <Text className="mt-4 text-xs text-gray-500 text-center">
              L'application comptabilité sera disponible prochainement
            </Text>
          </View>
        ) : (
          <View className="bg-white rounded-2xl shadow-lg p-6">
            <View className="items-center mb-4">
              <View className="bg-gray-100 rounded-full p-4 mb-4">
                <Lock size={48} color="#9CA3AF" />
              </View>
              <Text className="text-xl font-bold text-gray-900 text-center">
                Accès Producteurs
              </Text>
              <Text className="mt-2 text-sm text-gray-600 text-center">
                Cette section est réservée aux producteurs
              </Text>
            </View>

            <View className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <Text className="text-sm text-amber-900 text-center">
                Pour accéder à la comptabilité, vous devez avoir un compte producteur validé
              </Text>
            </View>
          </View>
        )}

        {/* Info box */}
        <View className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <Text className="text-xs text-blue-900 font-semibold mb-1">
            ℹ️ Application dédiée
          </Text>
          <Text className="text-xs text-blue-700">
            La comptabilité sera accessible via une application web dédiée pour une meilleure expérience
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
