/**
 * Écran de connexion - Les Chanvriers Unis
 * Connexion avec Supabase Auth (email/password)
 */

import React, { useState, useCallback } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, TextInput } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle,
} from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { useAuth } from '@/lib/useAuth';
import { PENDING_SIGNUP_ROLE_KEY, PENDING_SIGNUP_EMAIL_KEY } from './signup';
import { AuthErrorBanner, canRetryAuthError, getAuthErrorType } from '@/components/AuthErrorBanner';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    signIn,
    isSigningIn,
    signInError,
    resetSignInError,
    resendConfirmationEmail,
    isResendingConfirmation,
    updateProfile,
  } = useAuth();

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Messages
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmationResent, setConfirmationResent] = useState(false);

  // État de retry
  const [isRetrying, setIsRetrying] = useState(false);

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Trim and normalize email for validation
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      newErrors.email = 'Email requis';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      newErrors.email = 'Email invalide';
    }

    if (!password) {
      newErrors.password = 'Mot de passe requis';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle password login
  const handlePasswordLogin = async () => {
    if (!validateForm()) return;

    // Normalize email before sending
    const normalizedEmail = email.trim().toLowerCase();

    try {
      await signIn({ email: normalizedEmail, password });

      // Check if there's a pending role from signup
      const pendingRole = await AsyncStorage.getItem(PENDING_SIGNUP_ROLE_KEY);
      const pendingEmail = await AsyncStorage.getItem(PENDING_SIGNUP_EMAIL_KEY);

      // Note: Email not logged for security

      if (pendingRole && pendingEmail && pendingEmail === normalizedEmail) {
        try {
          // Si c'est un compte pro, définir pro_status à 'pending'
          const profileUpdate: { role: 'client' | 'pro' | 'producer'; pro_status?: string } = {
            role: pendingRole as 'client' | 'pro' | 'producer'
          };
          if (pendingRole === 'pro') {
            profileUpdate.pro_status = 'pending';
          }
          await updateProfile(profileUpdate);
        } catch (updateError) {
          console.error('[Login] Failed to update role:', updateError);
        }
        // Clear pending data
        await AsyncStorage.removeItem(PENDING_SIGNUP_ROLE_KEY);
        await AsyncStorage.removeItem(PENDING_SIGNUP_EMAIL_KEY);
      }

      // Navigate to home on success
      router.replace('/(tabs)');
    } catch (error) {
      // Error is handled by the hook
    }
  };

  // Gérer le retry pour les erreurs réseau
  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    setConfirmationResent(false);
    try {
      resetSignInError();
      await handlePasswordLogin();
    } finally {
      setIsRetrying(false);
    }
  }, [email, password]);

  // Renvoyer l'email de confirmation
  const handleResendConfirmation = useCallback(async () => {
    if (!email.trim()) return;

    const normalizedEmail = email.trim().toLowerCase();
    try {
      await resendConfirmationEmail(normalizedEmail);
      setConfirmationResent(true);
      // Reset le message après 10 secondes
      setTimeout(() => setConfirmationResent(false), 10000);
    } catch (error) {
      // L'erreur est gérée par le hook
      console.warn('[Login] Failed to resend confirmation:', error);
    }
  }, [email, resendConfirmationEmail]);

  // Détecter si l'erreur suggère un problème de confirmation email
  const errorMessage = signInError?.message || '';
  const isEmailConfirmationIssue = errorMessage.toLowerCase().includes('confirmation') ||
    errorMessage.toLowerCase().includes('confirmé') ||
    errorMessage.toLowerCase().includes('spam');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1"
      style={{ backgroundColor: COLORS.background.nightSky }}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Text style={{ color: COLORS.text.white }} className="text-2xl font-bold text-center mb-2">
          Connexion
        </Text>
        <Text style={{ color: COLORS.text.muted }} className="text-center mb-8">
          Bienvenue sur Les Chanvriers Unis
        </Text>

        {/* Email input */}
        <View className="mb-4">
          <Text style={{ color: COLORS.text.lightGray }} className="text-sm font-medium mb-2">
            Email
          </Text>
          <View
            className="flex-row items-center rounded-xl overflow-hidden"
            style={{
              backgroundColor: `${COLORS.text.white}05`,
              borderWidth: 1,
              borderColor: errors.email ? COLORS.accent.red : `${COLORS.primary.paleGold}20`,
            }}
          >
            <View className="px-4">
              <Mail size={20} color={COLORS.text.muted} />
            </View>
            <TextInput
              value={email}
              onChangeText={(text) => {
                setEmail(text.replace(/^\s+/, ''));
                if (errors.email) setErrors((e) => ({ ...e, email: '' }));
              }}
              onBlur={() => {
                setEmail(email.trim());
              }}
              placeholder="votre@email.com"
              placeholderTextColor={COLORS.text.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              className="flex-1 py-4 pr-4"
              style={{ color: COLORS.text.white }}
            />
          </View>
          {errors.email && (
            <Text style={{ color: COLORS.accent.red }} className="text-xs mt-1">
              {errors.email}
            </Text>
          )}
        </View>

        {/* Password input */}
        <View className="mb-6">
          <Text style={{ color: COLORS.text.lightGray }} className="text-sm font-medium mb-2">
            Mot de passe
          </Text>
          <View
            className="flex-row items-center rounded-xl overflow-hidden"
            style={{
              backgroundColor: `${COLORS.text.white}05`,
              borderWidth: 1,
              borderColor: errors.password ? COLORS.accent.red : `${COLORS.primary.paleGold}20`,
            }}
          >
            <View className="px-4">
              <Lock size={20} color={COLORS.text.muted} />
            </View>
            <TextInput
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (errors.password) setErrors((e) => ({ ...e, password: '' }));
              }}
              placeholder="Votre mot de passe"
              placeholderTextColor={COLORS.text.muted}
              secureTextEntry={!showPassword}
              autoComplete="password"
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
          {errors.password && (
            <Text style={{ color: COLORS.accent.red }} className="text-xs mt-1">
              {errors.password}
            </Text>
          )}
        </View>

        {/* Error message with retry button */}
        {signInError && (
          <AuthErrorBanner
            error={signInError}
            onRetry={handleRetry}
            isRetrying={isRetrying}
            onDismiss={() => {
              resetSignInError();
            }}
            showDismiss={!canRetryAuthError(getAuthErrorType(signInError))}
          />
        )}

        {/* Bouton renvoyer email de confirmation */}
        {isEmailConfirmationIssue && email.trim() && (
          <View className="mb-4">
            {confirmationResent ? (
              <View
                className="flex-row items-center justify-center py-3 px-4 rounded-xl"
                style={{ backgroundColor: `${COLORS.accent.hemp}20` }}
              >
                <CheckCircle size={18} color={COLORS.accent.hemp} />
                <Text style={{ color: COLORS.accent.hemp }} className="ml-2 text-sm font-medium">
                  Email de confirmation renvoyé ! Vérifiez votre boîte mail.
                </Text>
              </View>
            ) : (
              <Pressable
                onPress={handleResendConfirmation}
                disabled={isResendingConfirmation}
                className="flex-row items-center justify-center py-3 px-4 rounded-xl active:opacity-80"
                style={{
                  backgroundColor: `${COLORS.accent.teal}15`,
                  borderWidth: 1,
                  borderColor: `${COLORS.accent.teal}30`,
                  opacity: isResendingConfirmation ? 0.6 : 1,
                }}
              >
                {isResendingConfirmation ? (
                  <ActivityIndicator size="small" color={COLORS.accent.teal} />
                ) : (
                  <RefreshCw size={16} color={COLORS.accent.teal} />
                )}
                <Text style={{ color: COLORS.accent.teal }} className="ml-2 text-sm font-medium">
                  {isResendingConfirmation ? 'Envoi en cours...' : 'Renvoyer l\'email de confirmation'}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Login button */}
        <Pressable
          onPress={handlePasswordLogin}
          disabled={isSigningIn}
          className="rounded-xl py-4 items-center active:opacity-80"
          style={{
            backgroundColor: COLORS.primary.gold,
            opacity: isSigningIn ? 0.6 : 1,
          }}
        >
          {isSigningIn ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff' }} className="font-bold text-base">
              Se connecter
            </Text>
          )}
        </Pressable>

        {/* Forgot password link */}
        <Pressable
          onPress={() => router.push('/auth/forgot-password')}
          className="mt-4 py-2"
        >
          <Text style={{ color: COLORS.text.muted }} className="text-center">
            Mot de passe oublié ?
          </Text>
        </Pressable>

        {/* Signup link */}
        <Pressable
          onPress={() => router.push('/auth/signup')}
          className="mt-4 py-2"
        >
          <Text style={{ color: COLORS.text.muted }} className="text-center">
            Pas encore de compte ?{' '}
            <Text style={{ color: COLORS.primary.gold }}>S'inscrire</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
