/**
 * Écran de confirmation d'email - Les Chanvriers Unis
 * Affiché après que l'utilisateur a cliqué sur le lien de confirmation dans son email
 */

import React, { useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Check, AlertCircle, Mail } from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase-auth';

export default function EmailConfirmedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    type?: string;
    error?: string;
    error_description?: string;
  }>();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const verifyConfirmation = async () => {
      // Check if there's an error in the URL params
      if (params.error) {
        console.warn('[EmailConfirmed] Error in params:', params.error, params.error_description);
        setErrorMessage(params.error_description || params.error || 'Une erreur est survenue');
        setStatus('error');
        return;
      }

      // If we have an access token and the type is signup or email_confirmation
      if (params.access_token && (params.type === 'signup' || params.type === 'email' || params.type === 'magiclink')) {
        try {
          // Verify the token is valid by calling the user endpoint
          const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            method: 'GET',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${params.access_token}`,
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            const userData = await response.json();
            setStatus('success');
          } else {
            console.warn('[EmailConfirmed] Token validation failed:', response.status);
            setErrorMessage('Le lien de confirmation a expiré ou est invalide.');
            setStatus('error');
          }
        } catch (err) {
          console.warn('[EmailConfirmed] Verification error:', err);
          setErrorMessage('Erreur lors de la vérification.');
          setStatus('error');
        }
      } else if (!params.access_token && !params.error) {
        // No token and no error - the user may have already confirmed
        // Show success anyway since Supabase redirects here after confirmation
        setStatus('success');
      } else {
        // No token provided
        setErrorMessage('Lien de confirmation invalide.');
        setStatus('error');
      }
    };

    // Small delay to show loading state
    const timer = setTimeout(verifyConfirmation, 500);
    return () => clearTimeout(timer);
  }, [params]);

  // Loading state
  if (status === 'loading') {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{
          backgroundColor: COLORS.background.nightSky,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <ActivityIndicator size="large" color={COLORS.primary.gold} />
        <Text style={{ color: COLORS.text.muted }} className="mt-4">
          Vérification en cours...
        </Text>
      </View>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <View
        className="flex-1 px-6 items-center justify-center"
        style={{
          backgroundColor: COLORS.background.nightSky,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View
          className="w-24 h-24 rounded-full items-center justify-center mb-6"
          style={{ backgroundColor: `${COLORS.accent.red}20` }}
        >
          <AlertCircle size={48} color={COLORS.accent.red} />
        </View>

        <Text style={{ color: COLORS.text.white }} className="text-2xl font-bold text-center mb-3">
          Erreur de confirmation
        </Text>

        <Text style={{ color: COLORS.text.muted }} className="text-center mb-8 px-4">
          {errorMessage}
        </Text>

        <Pressable
          onPress={() => router.replace('/auth/login')}
          className="rounded-xl py-4 px-8 mb-4"
          style={{ backgroundColor: COLORS.primary.gold }}
        >
          <Text style={{ color: '#fff' }} className="font-bold text-base">
            Aller à la connexion
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace('/auth/signup')}
          className="py-2"
        >
          <Text style={{ color: COLORS.text.muted }}>
            Créer un nouveau compte
          </Text>
        </Pressable>
      </View>
    );
  }

  // Success state
  return (
    <View
      className="flex-1 px-6 items-center justify-center"
      style={{
        backgroundColor: COLORS.background.nightSky,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <View
        className="w-24 h-24 rounded-full items-center justify-center mb-6"
        style={{ backgroundColor: `${COLORS.accent.hemp}20` }}
      >
        <Check size={48} color={COLORS.accent.hemp} />
      </View>

      <Text style={{ color: COLORS.text.white }} className="text-2xl font-bold text-center mb-3">
        Email confirmé !
      </Text>

      <Text style={{ color: COLORS.text.muted }} className="text-center mb-2">
        Votre compte a été créé avec succès.
      </Text>

      <Text style={{ color: COLORS.text.muted }} className="text-center mb-8 px-4">
        Vous pouvez maintenant vous connecter avec votre email et mot de passe.
      </Text>

      <View
        className="rounded-xl p-4 mb-8 w-full"
        style={{ backgroundColor: `${COLORS.accent.teal}15` }}
      >
        <View className="flex-row items-center mb-2">
          <Mail size={20} color={COLORS.accent.teal} />
          <Text style={{ color: COLORS.accent.teal }} className="ml-2 font-medium">
            Prochaine étape
          </Text>
        </View>
        <Text style={{ color: COLORS.text.lightGray }} className="text-sm">
          Connectez-vous pour compléter votre profil et accéder à toutes les fonctionnalités.
        </Text>
      </View>

      <Pressable
        onPress={() => router.replace('/auth/login')}
        className="rounded-xl py-4 px-8 w-full items-center active:opacity-80"
        style={{ backgroundColor: COLORS.primary.gold }}
      >
        <Text style={{ color: '#fff' }} className="font-bold text-base">
          Se connecter
        </Text>
      </Pressable>
    </View>
  );
}
