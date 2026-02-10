/**
 * DirectSalesSettingsForm - Paramètres de vente directe à la ferme
 * Permet de configurer l'adresse, horaires et instructions de retrait
 */

import React, { useState, useEffect } from 'react';
import { View, Pressable, ActivityIndicator, Switch } from 'react-native';
import { Text, TextInput } from '@/components/ui';
import {
  MapPin,
  Store,
  Clock,
  Info,
  Check,
  AlertCircle,
  Truck,
} from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { UserProfile } from '@/lib/supabase-auth';

interface DirectSalesSettingsFormProps {
  profile: UserProfile | null;
  onSave: (data: Partial<UserProfile>) => Promise<void>;
  isSaving: boolean;
}

export function DirectSalesSettingsForm({ profile, onSave, isSaving }: DirectSalesSettingsFormProps) {
  // Direct farm sales state
  const [venteDirecteFerme, setVenteDirecteFerme] = useState(false);
  const [adresseRetrait, setAdresseRetrait] = useState('');
  const [horairesRetrait, setHorairesRetrait] = useState('');
  const [instructionsRetrait, setInstructionsRetrait] = useState('');

  const [shippingEnabled, setShippingEnabled] = useState(false);
  const [shippingFee, setShippingFee] = useState('');
  const [shippingNote, setShippingNote] = useState('');

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState('');

  // Load existing profile data
  useEffect(() => {
    if (profile) {
      setVenteDirecteFerme(profile.vente_directe_ferme || false);
      setAdresseRetrait(profile.adresse_retrait || '');
      setHorairesRetrait(profile.horaires_retrait || '');
      setInstructionsRetrait(profile.instructions_retrait || '');
      setShippingEnabled(profile.shipping_enabled || false);
      setShippingFee(profile.shipping_fee != null ? String(profile.shipping_fee) : '');
      setShippingNote(profile.shipping_note || '');
    }
  }, [profile]);

  // Validate form
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (venteDirecteFerme) {
      if (!adresseRetrait.trim()) {
        newErrors.adresseRetrait = 'Adresse de retrait requise';
      }
    }

    if (shippingEnabled) {
      const normalizedFee = shippingFee.replace(',', '.').trim();
      const feeValue = normalizedFee ? Number(normalizedFee) : 0;
      if (Number.isNaN(feeValue) || feeValue < 0) {
        newErrors.shippingFee = 'Frais de livraison invalides';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle save
  const handleSave = async () => {
    if (!validate()) return;

    try {
      const normalizedFee = shippingFee.replace(',', '.').trim();
      const shippingFeeValue = shippingEnabled ? (normalizedFee ? Number(normalizedFee) : 0) : 0;

      await onSave({
        vente_directe_ferme: venteDirecteFerme,
        adresse_retrait: venteDirecteFerme ? adresseRetrait : null,
        horaires_retrait: venteDirecteFerme ? horairesRetrait || null : null,
        instructions_retrait: venteDirecteFerme ? instructionsRetrait || null : null,
        shipping_enabled: shippingEnabled,
        shipping_fee: shippingEnabled ? shippingFeeValue : 0,
        shipping_note: shippingEnabled ? shippingNote || null : null,
      });

      setSuccessMessage('Paramètres enregistrés !');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error saving direct sales settings:', error);
    }
  };

  return (
    <View>
      {/* Success message */}
      {successMessage && (
        <View
          className="rounded-xl p-3 mb-4 flex-row items-center"
          style={{ backgroundColor: `${COLORS.accent.hemp}15` }}
        >
          <Check size={18} color={COLORS.accent.hemp} />
          <Text style={{ color: COLORS.accent.hemp }} className="text-sm ml-2">
            {successMessage}
          </Text>
        </View>
      )}

      {/* DIRECT FARM SALES SECTION */}
      <View className="rounded-xl p-4" style={{ backgroundColor: `${COLORS.accent.hemp}10`, borderWidth: 1, borderColor: `${COLORS.accent.hemp}30` }}>
        <View className="flex-row items-center mb-4">
          <Store size={20} color={COLORS.accent.hemp} style={{ marginRight: 8 }} />
          <Text style={{ color: COLORS.text.white }} className="font-semibold text-base flex-1">
            Vente directe à la ferme
          </Text>
          <Switch
            value={venteDirecteFerme}
            onValueChange={setVenteDirecteFerme}
            trackColor={{ false: COLORS.text.muted, true: COLORS.accent.hemp }}
            thumbColor={venteDirecteFerme ? COLORS.accent.hemp : COLORS.text.lightGray}
          />
        </View>

        {venteDirecteFerme && (
          <View>
            {/* Pickup Address */}
            <View className="mb-4">
              <Text style={{ color: COLORS.text.lightGray }} className="text-xs mb-1">
                Adresse de retrait des commandes *
              </Text>
              <View
                className="flex-row items-start rounded-xl overflow-hidden"
                style={{
                  backgroundColor: `${COLORS.text.white}05`,
                  borderWidth: 1,
                  borderColor: errors.adresseRetrait ? COLORS.accent.red : `${COLORS.primary.paleGold}20`,
                  minHeight: 100,
                  paddingTop: 12,
                }}
              >
                <View className="px-3 pt-1">
                  <MapPin size={18} color={COLORS.text.muted} />
                </View>
                <TextInput
                  value={adresseRetrait}
                  onChangeText={(text) => {
                    setAdresseRetrait(text);
                    if (errors.adresseRetrait) setErrors((e) => ({ ...e, adresseRetrait: '' }));
                  }}
                  placeholder="123 Rue de la Ferme, 75001 Paris"
                  placeholderTextColor={COLORS.text.muted}
                  multiline
                  numberOfLines={3}
                  className="flex-1 py-3 pr-3"
                  style={{ color: COLORS.text.white }}
                />
              </View>
              {errors.adresseRetrait && (
                <View className="flex-row items-center mt-1">
                  <AlertCircle size={14} color={COLORS.accent.red} />
                  <Text style={{ color: COLORS.accent.red }} className="text-xs ml-1">
                    {errors.adresseRetrait}
                  </Text>
                </View>
              )}
            </View>

            {/* Opening Hours */}
            <View className="mb-4">
              <Text style={{ color: COLORS.text.lightGray }} className="text-xs mb-1">
                Horaires de retrait (ex: Lun-Ven 14h-18h)
              </Text>
              <View
                className="flex-row items-center rounded-xl overflow-hidden"
                style={{
                  backgroundColor: `${COLORS.text.white}05`,
                  borderWidth: 1,
                  borderColor: `${COLORS.primary.paleGold}20`,
                }}
              >
                <View className="px-3">
                  <Clock size={18} color={COLORS.text.muted} />
                </View>
                <TextInput
                  value={horairesRetrait}
                  onChangeText={setHorairesRetrait}
                  placeholder="Lundi-Vendredi 14h-18h, Samedi 9h-12h"
                  placeholderTextColor={COLORS.text.muted}
                  className="flex-1 py-3 pr-3"
                  style={{ color: COLORS.text.white }}
                />
              </View>
            </View>

            {/* Instructions */}
            <View className="mb-4">
              <Text style={{ color: COLORS.text.lightGray }} className="text-xs mb-1">
                Instructions complémentaires (accès, parking, etc.)
              </Text>
              <View
                className="flex-row items-start rounded-xl overflow-hidden"
                style={{
                  backgroundColor: `${COLORS.text.white}05`,
                  borderWidth: 1,
                  borderColor: `${COLORS.primary.paleGold}20`,
                  minHeight: 80,
                  paddingTop: 12,
                }}
              >
                <View className="px-3 pt-1">
                  <Info size={18} color={COLORS.text.muted} />
                </View>
                <TextInput
                  value={instructionsRetrait}
                  onChangeText={setInstructionsRetrait}
                  placeholder="Ex: Accès par la cour intérieure, parking gratuit"
                  placeholderTextColor={COLORS.text.muted}
                  multiline
                  numberOfLines={3}
                  className="flex-1 py-3 pr-3"
                  style={{ color: COLORS.text.white }}
                />
              </View>
            </View>
          </View>
        )}
      </View>

      {/* SHIPPING SECTION */}
      <View
        className="rounded-xl p-4 mt-4"
        style={{ backgroundColor: `${COLORS.primary.gold}10`, borderWidth: 1, borderColor: `${COLORS.primary.gold}30` }}
      >
        <View className="flex-row items-center mb-4">
          <Truck size={20} color={COLORS.primary.gold} style={{ marginRight: 8 }} />
          <Text style={{ color: COLORS.text.white }} className="font-semibold text-base flex-1">
            Livraison postale
          </Text>
          <Switch
            value={shippingEnabled}
            onValueChange={setShippingEnabled}
            trackColor={{ false: COLORS.text.muted, true: COLORS.primary.gold }}
            thumbColor={shippingEnabled ? COLORS.primary.gold : COLORS.text.lightGray}
          />
        </View>

        {shippingEnabled && (
          <View>
            <View className="mb-4">
              <Text style={{ color: COLORS.text.lightGray }} className="text-xs mb-1">
                Frais de livraison (€)
              </Text>
              <View
                className="flex-row items-center rounded-xl overflow-hidden"
                style={{
                  backgroundColor: `${COLORS.text.white}05`,
                  borderWidth: 1,
                  borderColor: errors.shippingFee ? COLORS.accent.red : `${COLORS.primary.paleGold}20`,
                }}
              >
                <View className="px-3">
                  <Info size={18} color={COLORS.text.muted} />
                </View>
                <TextInput
                  value={shippingFee}
                  onChangeText={(text) => {
                    setShippingFee(text);
                    if (errors.shippingFee) setErrors((e) => ({ ...e, shippingFee: '' }));
                  }}
                  placeholder="0.00"
                  placeholderTextColor={COLORS.text.muted}
                  keyboardType="decimal-pad"
                  className="flex-1 py-3 pr-3"
                  style={{ color: COLORS.text.white }}
                />
              </View>
              {errors.shippingFee && (
                <View className="flex-row items-center mt-1">
                  <AlertCircle size={14} color={COLORS.accent.red} />
                  <Text style={{ color: COLORS.accent.red }} className="text-xs ml-1">
                    {errors.shippingFee}
                  </Text>
                </View>
              )}
            </View>

            <View>
              <Text style={{ color: COLORS.text.lightGray }} className="text-xs mb-1">
                Note de livraison (optionnel)
              </Text>
              <View
                className="flex-row items-start rounded-xl overflow-hidden"
                style={{
                  backgroundColor: `${COLORS.text.white}05`,
                  borderWidth: 1,
                  borderColor: `${COLORS.primary.paleGold}20`,
                  minHeight: 80,
                  paddingTop: 12,
                }}
              >
                <View className="px-3 pt-1">
                  <Info size={18} color={COLORS.text.muted} />
                </View>
                <TextInput
                  value={shippingNote}
                  onChangeText={setShippingNote}
                  placeholder="Ex: Livraison sous 3-5 jours ouvrés"
                  placeholderTextColor={COLORS.text.muted}
                  multiline
                  numberOfLines={3}
                  className="flex-1 py-3 pr-3"
                  style={{ color: COLORS.text.white }}
                />
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Save Button */}
      <Pressable
        onPress={handleSave}
        disabled={isSaving}
        className="rounded-xl py-4 items-center active:opacity-80 mt-4"
        style={{
          backgroundColor: COLORS.primary.gold,
          opacity: isSaving ? 0.6 : 1,
        }}
      >
        {isSaving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: '#fff' }} className="font-bold text-base">
            Enregistrer
          </Text>
        )}
      </Pressable>
    </View>
  );
}
