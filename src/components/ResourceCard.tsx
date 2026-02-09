/**
 * ResourceCard — Mini-card for a professional resource/supplier
 */

import React from 'react';
import { View, Pressable, Image, Linking } from 'react-native';
import { Text } from '@/components/ui';
import { Globe, Mail, Phone, MapPin, Star } from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import type { ProResource } from '@/types/pro-resources';

interface ResourceCardProps {
  resource: ProResource;
}

export function ResourceCard({ resource }: ResourceCardProps) {
  const openUrl = (url: string) => Linking.openURL(url).catch(() => {});
  const openEmail = () => resource.email && openUrl(`mailto:${resource.email}`);
  const openPhone = () => resource.phone && openUrl(`tel:${resource.phone}`);
  const openWebsite = () => resource.website_url && openUrl(resource.website_url);

  return (
    <View
      className="rounded-2xl p-4 mb-3"
      style={{
        backgroundColor: COLORS.background.charcoal,
        borderWidth: 1.5,
        borderColor: resource.featured
          ? `${COLORS.primary.gold}40`
          : `${COLORS.primary.gold}15`,
      }}
    >
      <View className="flex-row items-start">
        {/* Logo / Placeholder */}
        {resource.logo_url ? (
          <Image
            source={{ uri: resource.logo_url }}
            className="w-14 h-14 rounded-xl mr-3"
            style={{ backgroundColor: COLORS.background.mediumBlue }}
            resizeMode="cover"
          />
        ) : (
          <View
            className="w-14 h-14 rounded-xl mr-3 items-center justify-center"
            style={{ backgroundColor: `${COLORS.primary.gold}15` }}
          >
            <Text
              style={{ color: COLORS.primary.gold, fontSize: 20, fontWeight: 'bold' }}
            >
              {resource.name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        {/* Info */}
        <View className="flex-1">
          <View className="flex-row items-center">
            <Text
              style={{ color: COLORS.text.cream }}
              className="font-bold text-base flex-1"
              numberOfLines={1}
            >
              {resource.name}
            </Text>
            {resource.featured && (
              <Star size={14} color={COLORS.primary.brightYellow} fill={COLORS.primary.brightYellow} />
            )}
          </View>

          {resource.description && (
            <Text
              style={{ color: COLORS.text.lightGray }}
              className="text-sm mt-1"
              numberOfLines={2}
            >
              {resource.description}
            </Text>
          )}

          {/* Location */}
          {(resource.city || resource.region) && (
            <View className="flex-row items-center mt-1.5">
              <MapPin size={12} color={COLORS.text.muted} />
              <Text style={{ color: COLORS.text.muted }} className="text-xs ml-1">
                {[resource.city, resource.region].filter(Boolean).join(', ')}
              </Text>
            </View>
          )}

          {/* Tags */}
          {resource.tags.length > 0 && (
            <View className="flex-row flex-wrap mt-2 gap-1">
              {resource.tags.slice(0, 3).map((tag) => (
                <View
                  key={tag}
                  className="px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${COLORS.accent.hemp}20` }}
                >
                  <Text style={{ color: COLORS.accent.hemp }} className="text-xs">
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>

      {/* Action buttons */}
      {(resource.website_url || resource.email || resource.phone) && (
        <View className="flex-row mt-3 gap-2">
          {resource.website_url && (
            <Pressable
              onPress={openWebsite}
              className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl"
              style={{ backgroundColor: `${COLORS.accent.sky}15` }}
            >
              <Globe size={16} color={COLORS.accent.sky} />
              <Text style={{ color: COLORS.accent.sky }} className="text-sm font-semibold ml-1.5">
                Site web
              </Text>
            </Pressable>
          )}
          {resource.email && (
            <Pressable
              onPress={openEmail}
              className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl"
              style={{ backgroundColor: `${COLORS.primary.gold}15` }}
            >
              <Mail size={16} color={COLORS.primary.gold} />
              <Text style={{ color: COLORS.primary.gold }} className="text-sm font-semibold ml-1.5">
                Email
              </Text>
            </Pressable>
          )}
          {resource.phone && (
            <Pressable
              onPress={openPhone}
              className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl"
              style={{ backgroundColor: `${COLORS.accent.hemp}15` }}
            >
              <Phone size={16} color={COLORS.accent.hemp} />
              <Text style={{ color: COLORS.accent.hemp }} className="text-sm font-semibold ml-1.5">
                Appeler
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
