/**
 * Écran réinitialisation de mot de passe - Les Chanvriers Unis
 * Permet à l'utilisateur de définir un nouveau mot de passe après avoir cliqué sur le lien email
 */

import React, { useState, useEffect } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Lock, Eye, EyeOff, Check, AlertCircle } from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase-auth';
import * as Linking from 'expo-linking';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ access_token?: string; refresh_token?: string; type?: string }>();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isValidToken, setIsValidToken] = useState<boolean | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Extraire les paramètres de l'URL (query params ou fragment)
  useEffect(() => {
    const extractTokenFromUrl = async () => {
      try {
        // D'abord essayer les query params de expo-router
        if (params.access_token && params.type === 'recovery') {
          console.log('[ResetPassword] Token found in query params');
          setAccessToken(params.access_token);
          return;
        }

        // Sinon, essayer de récupérer l'URL complète et parser le fragment
        const url = await Linking.getInitialURL();
        console.log('[ResetPassword] Initial URL:', url);

        if (url) {
          // Supabase peut envoyer les tokens dans le fragment (#) ou query (?)
          let tokenFromUrl: string | null = null;
          let typeFromUrl: string | null = null;

          // Parser le fragment si présent
          if (url.includes('#')) {
            const fragment = url.split('#')[1];
            if (fragment) {
              const fragmentParams = new URLSearchParams(fragment);
              tokenFromUrl = fragmentParams.get('access_token');
              typeFromUrl = fragmentParams.get('type');
            }
          }

          // Parser les query params si pas trouvé dans le fragment
          if (!tokenFromUrl && url.includes('?')) {
            const queryString = url.split('?')[1]?.split('#')[0];
            if (queryString) {
              const queryParams = new URLSearchParams(queryString);
              tokenFromUrl = queryParams.get('access_token');
              typeFromUrl = queryParams.get('type');
            }
          }

          if (tokenFromUrl && typeFromUrl === 'recovery') {
            console.log('[ResetPassword] Token found in URL fragment/query');
            setAccessToken(tokenFromUrl);
            return;
          }
        }

        // Aucun token trouvé
        console.log('[ResetPassword] No token found');
        setIsValidToken(false);
        setError('Lien de réinitialisation invalide. Veuillez demander un nouveau lien.');
      } catch (err) {
        console.warn('[ResetPassword] Error extracting token:', err);
        setIsValidToken(false);
        setError('Erreur lors de la lecture du lien.');
      }
    };

    extractTokenFromUrl();
  }, [params.access_token, params.type]);

  // Vérifier le token une fois extrait
  useEffect(() => {
    if (!accessToken) return;

    const verifyToken = async () => {
      console.log('[ResetPassword] Verifying token...');
      try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          method: 'GET',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          setIsValidToken(true);
          console.log('[ResetPassword] Token is valid');
        } else {
          console.warn('[ResetPassword] Token validation failed:', response.status);
          setIsValidToken(false);
          setError('Le lien de réinitialisation a expiré ou est invalide.');
        }
      } catch (err) {
        console.warn('[ResetPassword] Token verification error:', err);
        setIsValidToken(false);
        setError('Erreur de vérification du lien.');
      }
    };

    verifyToken();
  }, [accessToken]);

  const handleResetPassword = async () => {
    setError('');

    // Validations
    if (!password.trim()) {
      setError('Mot de passe requis');
      return;
    }

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    setIsLoading(true);

    try {
      if (!accessToken) {
        setError('Session invalide. Veuillez demander un nouveau lien.');
        setIsLoading(false);
        return;
      }

      // Mettre à jour le mot de passe directement via l'API Supabase avec le token de recovery
      const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.warn('[ResetPassword] Update failed:', data);
        setError(data.error_description || data.msg || 'Erreur lors de la mise à jour');
        setIsLoading(false);
        return;
      }

      console.log('[ResetPassword] Password updated successfully');
      setIsSuccess(true);
    } catch (err) {
      console.warn('[ResetPassword] Error:', err);
      setError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsLoading(false);
    }
  };

  // Écran de succès
  if (isSuccess) {
    return (
      <View
        className="flex-1 px-5 items-center justify-center"
        style={{ backgroundColor: COLORS.background.nightSky }}
      >
        <View
          className="w-20 h-20 rounded-full items-center justify-center mb-6"
          style={{ backgroundColor: `${COLORS.accent.hemp}20` }}
        >
          <Check size={40} color={COLORS.accent.hemp} />
        </View>
        <Text style={{ color: COLORS.text.white }} className="text-2xl font-bold text-center mb-2">
          Mot de passe modifié
        </Text>
        <Text style={{ color: COLORS.text.muted }} className="text-center mb-8 px-4">
          Votre mot de passe a été réinitialisé avec succès.{'\n'}
          Vous pouvez maintenant vous connecter.
        </Text>
        <Pressable
          onPress={() => router.replace('/auth/login')}
          className="rounded-xl py-4 px-8"
          style={{ backgroundColor: COLORS.primary.gold }}
        >
          <Text style={{ color: '#fff' }} className="font-bold">
            Se connecter
          </Text>
        </Pressable>
      </View>
    );
  }

  // Écran de chargement initial (vérification du token)
  if (isValidToken === null) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: COLORS.background.nightSky }}
      >
        <ActivityIndicator size="large" color={COLORS.primary.gold} />
        <Text style={{ color: COLORS.text.muted }} className="mt-4">
          Vérification du lien...
        </Text>
      </View>
    );
  }

  // Écran d'erreur (token invalide)
  if (!isValidToken) {
    return (
      <View
        className="flex-1 px-5 items-center justify-center"
        style={{ backgroundColor: COLORS.background.nightSky }}
      >
        <View
          className="w-20 h-20 rounded-full items-center justify-center mb-6"
          style={{ backgroundColor: `${COLORS.accent.red}20` }}
        >
          <AlertCircle size={40} color={COLORS.accent.red} />
        </View>
        <Text style={{ color: COLORS.text.white }} className="text-2xl font-bold text-center mb-2">
          Lien expiré
        </Text>
        <Text style={{ color: COLORS.text.muted }} className="text-center mb-8 px-4">
          {error || 'Ce lien de réinitialisation n\'est plus valide.\nVeuillez en demander un nouveau.'}
        </Text>
        <Pressable
          onPress={() => router.replace('/auth/forgot-password')}
          className="rounded-xl py-4 px-8 mb-4"
          style={{ backgroundColor: COLORS.primary.gold }}
        >
          <Text style={{ color: '#fff' }} className="font-bold">
            Demander un nouveau lien
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.replace('/auth/login')}
          className="py-2"
        >
          <Text style={{ color: COLORS.text.muted }}>
            Retour à la connexion
          </Text>
        </Pressable>
      </View>
    );
  }

  // Formulaire de réinitialisation
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1"
      style={{ backgroundColor: COLORS.background.nightSky }}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Text style={{ color: COLORS.text.white }} className="text-2xl font-bold text-center mb-2">
          Nouveau mot de passe
        </Text>
        <Text style={{ color: COLORS.text.muted }} className="text-center mb-8">
          Choisissez un mot de passe sécurisé
        </Text>

        {/* Password input */}
        <View className="mb-4">
          <Text style={{ color: COLORS.text.lightGray }} className="text-sm font-medium mb-2">
            Nouveau mot de passe
          </Text>
          <View
            className="flex-row items-center rounded-xl overflow-hidden"
            style={{
              backgroundColor: `${COLORS.text.white}05`,
              borderWidth: 1,
              borderColor: error && !password ? COLORS.accent.red : `${COLORS.primary.paleGold}20`,
            }}
          >
            <View className="px-4">
              <Lock size={20} color={COLORS.text.muted} />
            </View>
            <TextInput
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError('');
              }}
              placeholder="Minimum 8 caractères"
              placeholderTextColor={COLORS.text.muted}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              className="flex-1 py-4"
              style={{ color: COLORS.text.white }}
            />
            <Pressable onPress={() => setShowPassword(!showPassword)} className="px-4">
              {showPassword ? (
                <EyeOff size={20} color={COLORS.text.muted} />
              ) : (
                <Eye size={20} color={COLORS.text.muted} />
              )}
            </Pressable>
          </View>
        </View>

        {/* Confirm password input */}
        <View className="mb-6">
          <Text style={{ color: COLORS.text.lightGray }} className="text-sm font-medium mb-2">
            Confirmer le mot de passe
          </Text>
          <View
            className="flex-row items-center rounded-xl overflow-hidden"
            style={{
              backgroundColor: `${COLORS.text.white}05`,
              borderWidth: 1,
              borderColor: error && password !== confirmPassword ? COLORS.accent.red : `${COLORS.primary.paleGold}20`,
            }}
          >
            <View className="px-4">
              <Lock size={20} color={COLORS.text.muted} />
            </View>
            <TextInput
              value={confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                if (error) setError('');
              }}
              placeholder="Répétez le mot de passe"
              placeholderTextColor={COLORS.text.muted}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
              className="flex-1 py-4"
              style={{ color: COLORS.text.white }}
            />
            <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)} className="px-4">
              {showConfirmPassword ? (
                <EyeOff size={20} color={COLORS.text.muted} />
              ) : (
                <Eye size={20} color={COLORS.text.muted} />
              )}
            </Pressable>
          </View>
        </View>

        {/* Error message */}
        {error && (
          <View className="mb-4 p-3 rounded-lg" style={{ backgroundColor: `${COLORS.accent.red}20` }}>
            <Text style={{ color: COLORS.accent.red }} className="text-sm text-center">
              {error}
            </Text>
          </View>
        )}

        {/* Submit button */}
        <Pressable
          onPress={handleResetPassword}
          disabled={isLoading}
          className="rounded-xl py-4 items-center active:opacity-80"
          style={{
            backgroundColor: COLORS.primary.gold,
            opacity: isLoading ? 0.6 : 1,
          }}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff' }} className="font-bold text-base">
              Réinitialiser le mot de passe
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
