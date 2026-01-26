/**
 * Écran de connexion - Les Chanvriers Unis
 * Connexion avec Supabase Auth (email/password ou magic link)
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
  Sparkles,
  RefreshCw,
  CheckCircle,
} from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { useAuth } from '@/lib/useAuth';
import { PENDING_SIGNUP_ROLE_KEY, PENDING_SIGNUP_EMAIL_KEY } from './signup';
import { AuthErrorBanner, canRetryAuthError, getAuthErrorType } from '@/components/AuthErrorBanner';

type LoginMode = 'password' | 'magic-link';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    signIn,
    isSigningIn,
    signInError,
    signInErrorType,
    resetSignInError,
    sendMagicLink,
    isSendingMagicLink,
    magicLinkError,
    magicLinkErrorType,
    resetMagicLinkError,
    resendConfirmationEmail,
    isResendingConfirmation,
    updateProfile,
  } = useAuth();

  // Mode state
  const [mode, setMode] = useState<LoginMode>('password');

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Messages
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [magicLinkSent, setMagicLinkSent] = useState(false);
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

    if (mode === 'password' && !password) {
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

      console.log('[Login] Checking for pending role');
      // Note: Email not logged for security

      if (pendingRole && pendingEmail && pendingEmail === normalizedEmail) {
        console.log('[Login] Applying pending role:', pendingRole);
        try {
          // Si c'est un compte pro, définir pro_status à 'pending'
          const profileUpdate: { role: 'client' | 'pro' | 'producer'; pro_status?: string } = {
            role: pendingRole as 'client' | 'pro' | 'producer'
          };
          if (pendingRole === 'pro') {
            profileUpdate.pro_status = 'pending';
          }
          await updateProfile(profileUpdate);
          console.log('[Login] Role updated successfully');
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

  // Handle magic link
  const handleMagicLink = async () => {
    if (!validateForm()) return;

    // Normalize email before sending
    const normalizedEmail = email.trim().toLowerCase();

    try {
      await sendMagicLink(normalizedEmail);
      setMagicLinkSent(true);
    } catch (error) {
      // Error is handled by the hook
    }
  };

  // Gérer le retry pour les erreurs réseau
  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    setConfirmationResent(false);
    try {
      if (mode === 'password') {
        resetSignInError();
        await handlePasswordLogin();
      } else {
        resetMagicLinkError();
        await handleMagicLink();
      }
    } finally {
      setIsRetrying(false);
    }
  }, [mode, email, password]);

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
      console.log('[Login] Failed to resend confirmation:', error);
    }
  }, [email, resendConfirmationEmail]);

  // Reset erreurs quand on change de mode
  const handleModeChange = useCallback((newMode: LoginMode) => {
    setMode(newMode);
    setConfirmationResent(false);
    resetSignInError();
    resetMagicLinkError();
  }, [resetSignInError, resetMagicLinkError]);

  // Détecter si l'erreur suggère un problème de confirmation email
  const errorMessage = signInError?.message || magicLinkError?.message || '';
  const isEmailConfirmationIssue = errorMessage.toLowerCase().includes('confirmation') ||
    errorMessage.toLowerCase().includes('confirmé') ||
    errorMessage.toLowerCase().includes('spam');

  // Magic link sent view
  if (magicLinkSent) {
    return (
      <View
        className="flex-1 px-5 items-center justify-center"
        style={{ backgroundColor: COLORS.background.nightSky }}
      >
        <View
          className="w-20 h-20 rounded-full items-center justify-center mb-6"
          style={{ backgroundColor: `${COLORS.accent.hemp}20` }}
        >
          <Mail size={40} color={COLORS.accent.hemp} />
        </View>
        <Text style={{ color: COLORS.text.white }} className="text-2xl font-bold text-center mb-2">
          Vérifiez votre email
        </Text>
        <Text style={{ color: COLORS.text.muted }} className="text-center mb-8 px-4">
          Un lien de connexion a été envoyé à{'\n'}
          <Text style={{ color: COLORS.primary.gold }}>{email}</Text>
        </Text>
        <Pressable
          onPress={() => setMagicLinkSent(false)}
          className="py-3"
        >
          <Text style={{ color: COLORS.text.muted }}>
            Utiliser un autre email
          </Text>
        </Pressable>
      </View>
    );
  }

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

        {/* Mode selector */}
        <View
          className="flex-row rounded-xl overflow-hidden mb-6"
          style={{
            backgroundColor: `${COLORS.text.white}05`,
            borderWidth: 1,
            borderColor: `${COLORS.primary.paleGold}20`,
          }}
        >
          <Pressable
            onPress={() => handleModeChange('password')}
            className="flex-1 py-3 items-center"
            style={{
              backgroundColor: mode === 'password' ? COLORS.primary.gold : 'transparent',
            }}
          >
            <Text
              style={{ color: mode === 'password' ? '#fff' : COLORS.text.muted }}
              className="font-medium"
            >
              Mot de passe
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleModeChange('magic-link')}
            className="flex-1 py-3 items-center flex-row justify-center"
            style={{
              backgroundColor: mode === 'magic-link' ? COLORS.accent.teal : 'transparent',
            }}
          >
            <Sparkles size={16} color={mode === 'magic-link' ? '#fff' : COLORS.text.muted} />
            <Text
              style={{ color: mode === 'magic-link' ? '#fff' : COLORS.text.muted }}
              className="font-medium ml-1"
            >
              Lien magique
            </Text>
          </Pressable>
        </View>

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
                // Remove leading spaces as user types
                setEmail(text.replace(/^\s+/, ''));
                if (errors.email) setErrors((e) => ({ ...e, email: '' }));
              }}
              onBlur={() => {
                // Trim trailing spaces on blur
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

        {/* Password input (only for password mode) */}
        {mode === 'password' && (
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
        )}

        {/* Magic link info */}
        {mode === 'magic-link' && (
          <View
            className="rounded-xl p-4 mb-6"
            style={{ backgroundColor: `${COLORS.accent.teal}10` }}
          >
            <Text style={{ color: COLORS.accent.teal }} className="text-sm text-center">
              Un lien de connexion sera envoyé à votre adresse email.
              Cliquez dessus pour vous connecter instantanément.
            </Text>
          </View>
        )}

        {/* Error message with retry button */}
        {(signInError || magicLinkError) && (
          <AuthErrorBanner
            error={signInError || magicLinkError}
            onRetry={handleRetry}
            isRetrying={isRetrying}
            onDismiss={() => {
              resetSignInError();
              resetMagicLinkError();
            }}
            showDismiss={!canRetryAuthError(getAuthErrorType(signInError || magicLinkError))}
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
          onPress={mode === 'password' ? handlePasswordLogin : handleMagicLink}
          disabled={isSigningIn || isSendingMagicLink}
          className="rounded-xl py-4 items-center active:opacity-80"
          style={{
            backgroundColor: mode === 'password' ? COLORS.primary.gold : COLORS.accent.teal,
            opacity: (isSigningIn || isSendingMagicLink) ? 0.6 : 1,
          }}
        >
          {(isSigningIn || isSendingMagicLink) ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff' }} className="font-bold text-base">
              {mode === 'password' ? 'Se connecter' : 'Envoyer le lien'}
            </Text>
          )}
        </Pressable>

        {/* Forgot password link (only for password mode) */}
        {mode === 'password' && (
          <Pressable
            onPress={() => router.push('/auth/forgot-password')}
            className="mt-4 py-2"
          >
            <Text style={{ color: COLORS.text.muted }} className="text-center">
              Mot de passe oublié ?
            </Text>
          </Pressable>
        )}

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
