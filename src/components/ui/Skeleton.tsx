import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

type SkeletonWidth = number | `${number}%`;

interface SkeletonProps {
  width?: SkeletonWidth;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  width = '100%',
  height = 12,
  radius = 8,
  style,
}: SkeletonProps) {
  const resolvedWidth: SkeletonWidth = typeof width === 'string' ? (width as `${number}%`) : width;
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.9, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width: resolvedWidth,
          height,
          borderRadius: radius,
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
        },
        animatedStyle,
        style,
      ]}
    />
  );
}
