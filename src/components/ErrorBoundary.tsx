/**
 * ErrorBoundary - Capture les erreurs JS et affiche un écran de fallback
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import { COLORS } from '@/lib/colors';

const MONOSPACE_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);

    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={{
          flex: 1,
          backgroundColor: COLORS.background.nightSky,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}>
          <Text style={{
            color: '#FF6B6B',
            fontSize: 20,
            fontWeight: 'bold',
            marginBottom: 16,
            textAlign: 'center',
          }}>
            Une erreur est survenue
          </Text>

          <Text style={{
            color: COLORS.text.muted,
            fontSize: 14,
            textAlign: 'center',
            marginBottom: 24,
          }}>
            L'application a rencontré un problème inattendu.
          </Text>

          {__DEV__ && this.state.error && (
            <ScrollView
              style={{
                maxHeight: 200,
                backgroundColor: '#1a1a1a',
                borderRadius: 8,
                padding: 12,
                marginBottom: 24,
                width: '100%',
              }}
            >
              <Text style={{ color: '#FF6B6B', fontSize: 12, fontFamily: MONOSPACE_FONT }}>
                {this.state.error.toString()}
              </Text>
              {this.state.errorInfo?.componentStack && (
                <Text style={{ color: '#888', fontSize: 10, marginTop: 8, fontFamily: MONOSPACE_FONT }}>
                  {this.state.errorInfo.componentStack.slice(0, 500)}
                </Text>
              )}
            </ScrollView>
          )}

          <Pressable
            onPress={this.handleRetry}
            style={({ pressed }) => ({
              backgroundColor: pressed ? COLORS.primary.gold + '80' : COLORS.primary.gold,
              paddingHorizontal: 32,
              paddingVertical: 14,
              borderRadius: 12,
            })}
          >
            <Text style={{ color: '#000', fontWeight: '600', fontSize: 16 }}>
              Réessayer
            </Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
