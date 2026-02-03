/**
 * LabAnalysisViewer - Composant de visualisation pour les analyses de laboratoire
 * Affiche un bouton pour voir l'analyse et un modal pour visualiser le document
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Pressable,
  Modal,
  Alert,
  Dimensions,
  Share,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Text } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { WebView } from 'react-native-webview';
import {
  FileText,
  X,
  Share2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { getSupabaseConfig } from '@/lib/env-validation';
import { getSession } from '@/lib/supabase-auth';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Composant pour afficher un PDF
function PdfViewer({ uri }: { uri: string }) {
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPdf();
  }, [uri]);

  const loadPdf = async () => {
    try {
      setLoading(true);
      setError(null);

      // Sur le web, on utilise directement l'URL dans une iframe ou on affiche un lien
      if (Platform.OS === 'web') {
        // Pour le web, on ne charge pas en base64, on utilise directement l'URL
        setPdfBase64('WEB_DIRECT');
        setLoading(false);
        return;
      }

      let base64Data: string;

      if (uri.startsWith('http://') || uri.startsWith('https://')) {
        // Pour les URLs distantes, télécharger d'abord
        const localUri = `${FileSystem.cacheDirectory}temp_pdf_${Date.now()}.pdf`;
        const download = await FileSystem.downloadAsync(uri, localUri);
        if (download.status !== 200) {
          throw new Error('Échec du téléchargement');
        }
        base64Data = await FileSystem.readAsStringAsync(download.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        // Pour les fichiers locaux (incluant DocumentPicker)
        const sourceUri = uri.startsWith('file://') ? uri : `file://${uri}`;
        const destUri = `${FileSystem.cacheDirectory}temp_pdf_view_${Date.now()}.pdf`;

        // Toujours copier le fichier d'abord pour garantir l'accès
        // Cela résout le problème des fichiers DocumentPicker non accessibles directement
        try {
          await FileSystem.copyAsync({
            from: sourceUri,
            to: destUri,
          });
          base64Data = await FileSystem.readAsStringAsync(destUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } catch (copyError) {
          // Essayer avec l'URI originale sans le préfixe file://
          try {
            const cleanUri = uri.replace('file://', '');
            await FileSystem.copyAsync({
              from: uri,
              to: destUri,
            });
            base64Data = await FileSystem.readAsStringAsync(destUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
          } catch (secondError) {
            // Dernier recours: essayer de lire directement
            try {
              base64Data = await FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.Base64,
              });
            } catch (readError) {
              throw new Error('Fichier non accessible. Veuillez réessayer de sélectionner le document.');
            }
          }
        }
      }

      setPdfBase64(base64Data);
    } catch (err) {
      console.error('[PdfViewer] Error loading PDF:', err);
      setError(err instanceof Error ? err.message : 'Impossible de charger le PDF');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={COLORS.primary.gold} />
        <Text style={{ color: COLORS.text.cream }} className="mt-4">
          Chargement du PDF...
        </Text>
      </View>
    );
  }

  if (error || !pdfBase64) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <FileText size={64} color={COLORS.accent.red} />
        <Text style={{ color: COLORS.text.cream }} className="text-lg font-bold mt-4 text-center">
          {error || 'Erreur de chargement'}
        </Text>
        <Pressable
          onPress={loadPdf}
          className="mt-4 px-6 py-3 rounded-xl"
          style={{ backgroundColor: COLORS.primary.gold }}
        >
          <Text style={{ color: COLORS.text.dark }} className="font-bold">
            Réessayer
          </Text>
        </Pressable>
      </View>
    );
  }

  // Sur le web, afficher dans une iframe ou avec Google Docs Viewer
  if (Platform.OS === 'web') {
    // Utiliser Google Docs Viewer pour les URLs distantes sur le web
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(uri)}&embedded=true`;
      return (
        <View style={{ flex: 1 }}>
          <iframe
            src={viewerUrl}
            style={{
              flex: 1,
              width: '100%',
              height: '100%',
              border: 'none',
              backgroundColor: '#000'
            }}
            title="PDF Viewer"
          />
        </View>
      );
    }

    // Pour les fichiers locaux sur web, afficher un message
    return (
      <View className="flex-1 items-center justify-center px-6">
        <FileText size={64} color={COLORS.primary.gold} />
        <Text style={{ color: COLORS.text.cream }} className="text-lg font-bold mt-4 text-center">
          Aperçu PDF
        </Text>
        <Text style={{ color: COLORS.text.muted }} className="text-center mt-2">
          Ouvrez ce document sur l'application mobile pour une meilleure expérience
        </Text>
      </View>
    );
  }

  // Afficher le PDF avec WebView en utilisant pdf.js (natif seulement)
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #000;
          display: flex;
          flex-direction: column;
          align-items: center;
          min-height: 100vh;
          padding: 10px;
        }
        #pdf-container {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        canvas {
          max-width: 100%;
          height: auto;
          background: white;
          box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
        .loading {
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 16px;
          text-align: center;
          padding: 20px;
        }
        .page-info {
          color: #888;
          font-size: 12px;
          margin-top: 5px;
        }
      </style>
    </head>
    <body>
      <div id="pdf-container">
        <div class="loading">Rendu du PDF...</div>
      </div>
      <script>
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const base64Data = '${pdfBase64}';
        const pdfData = atob(base64Data);
        const uint8Array = new Uint8Array(pdfData.length);
        for (let i = 0; i < pdfData.length; i++) {
          uint8Array[i] = pdfData.charCodeAt(i);
        }

        const container = document.getElementById('pdf-container');

        pdfjsLib.getDocument({ data: uint8Array }).promise.then(async function(pdf) {
          container.innerHTML = '';
          const totalPages = pdf.numPages;

          for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const scale = 2;
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport }).promise;

            container.appendChild(canvas);

            if (totalPages > 1) {
              const pageInfo = document.createElement('div');
              pageInfo.className = 'page-info';
              pageInfo.textContent = 'Page ' + pageNum + ' / ' + totalPages;
              container.appendChild(pageInfo);
            }
          }
        }).catch(function(error) {
          container.innerHTML = '<div class="loading">Erreur: ' + error.message + '</div>';
        });
      </script>
    </body>
    </html>
  `;

  return (
    <WebView
      source={{ html: htmlContent }}
      style={{ flex: 1, backgroundColor: '#000' }}
      originWhitelist={['*']}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      startInLoadingState={true}
      renderLoading={() => (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
          <ActivityIndicator size="large" color={COLORS.primary.gold} />
        </View>
      )}
    />
  );
}

interface LabAnalysisViewerProps {
  url: string;
  compact?: boolean;
}

export function LabAnalysisViewer({ url, compact = false }: LabAnalysisViewerProps) {
  const insets = useSafeAreaInsets();
  const [showViewer, setShowViewer] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  // Zoom pour la visualisation d'image
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const displayUrl = resolvedUrl ?? url;

  // Déterminer si c'est un PDF ou une image
  const isPdf = displayUrl?.toLowerCase().endsWith('.pdf') || displayUrl?.includes('application/pdf');

  useEffect(() => {
    let isMounted = true;

    const resolveSignedUrl = async () => {
      setResolveError(null);

      if (!url) {
        setResolvedUrl(null);
        return;
      }

      const isRemote = url.startsWith('http://') || url.startsWith('https://');
      const isLocal = url.startsWith('file://') || url.startsWith('/data/') || url.includes('/cache/');
      if (isRemote || isLocal) {
        setResolvedUrl(url);
        return;
      }

      const session = getSession();
      if (!session?.access_token) {
        setResolveError('Connexion requise pour accéder à l’analyse.');
        setResolvedUrl(null);
        return;
      }

      try {
        setIsResolving(true);
        const { url: supabaseUrl, anonKey } = getSupabaseConfig();
        const response = await fetch(`${supabaseUrl}/functions/v1/lab-analyses-url`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': anonKey,
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ path: url }),
        });

        if (!response.ok) {
          throw new Error('Impossible de générer l\'URL sécurisée');
        }

        const data = await response.json();
        if (isMounted) {
          setResolvedUrl(data?.url || null);
        }
      } catch (error) {
        if (isMounted) {
          setResolveError(error instanceof Error ? error.message : 'Erreur de chargement');
          setResolvedUrl(null);
        }
      } finally {
        if (isMounted) {
          setIsResolving(false);
        }
      }
    };

    resolveSignedUrl();

    return () => {
      isMounted = false;
    };
  }, [url]);

  // Ouvrir le visualiseur
  const openViewer = () => {
    // Reset zoom
    scale.value = 1;
    savedScale.value = 1;
    setShowViewer(true);
  };

  // Partager le document
  const shareDocument = async () => {
    try {
      // Sur le web, utiliser l'API Web Share ou ouvrir dans un nouvel onglet
      if (Platform.OS === 'web') {
        if (displayUrl?.startsWith('http://') || displayUrl?.startsWith('https://')) {
          // Essayer l'API Web Share si disponible
          if (typeof navigator !== 'undefined' && navigator.share) {
            try {
              await navigator.share({
                title: 'Analyse de laboratoire',
                url: displayUrl,
              });
              return;
            } catch (shareError) {
              // Si l'utilisateur annule ou l'API échoue, ouvrir dans un nouvel onglet
            }
          }
          // Ouvrir dans un nouvel onglet
          window.open(displayUrl, '_blank');
        }
        return;
      }

      if (!displayUrl) {
        throw new Error(resolveError || 'Analyse indisponible');
      }

      const isRemoteUrl = displayUrl.startsWith('http://') || displayUrl.startsWith('https://');

      if (isRemoteUrl) {
        const extension = isPdf ? '.pdf' : (displayUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[0] || '.jpg');
        const cleanFileName = `analyse_labo_${Date.now()}${extension}`;
        const localUri = `${FileSystem.cacheDirectory}${cleanFileName}`;

        const downloadResult = await FileSystem.downloadAsync(displayUrl, localUri);

        if (downloadResult.status === 200) {
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) {
            await Sharing.shareAsync(downloadResult.uri, {
              mimeType: isPdf ? 'application/pdf' : 'image/jpeg',
              dialogTitle: 'Partager l\'analyse',
              UTI: isPdf ? 'com.adobe.pdf' : 'public.jpeg',
            });
          } else {
            await Share.share({
              message: `Analyse de laboratoire: ${displayUrl}`,
            });
          }
        } else {
          throw new Error('Échec du téléchargement');
        }
      } else if (displayUrl.startsWith('file://') || displayUrl.startsWith('/data/') || displayUrl.includes('/cache/')) {
        // Pour les fichiers locaux ou dans le cache
        const extension = isPdf ? '.pdf' : '.jpg';
        const fileName = `analyse_labo_${Date.now()}${extension}`;
        const destinationUri = `${FileSystem.cacheDirectory}${fileName}`;

        const sourceUri = displayUrl.startsWith('file://') ? displayUrl : `file://${displayUrl}`;

        // Vérifier si le fichier source existe
        try {
          const fileInfo = await FileSystem.getInfoAsync(sourceUri);
          if (!fileInfo.exists) {
            // Fichier n'existe pas, partager juste l'URL
            await Share.share({
              message: `Analyse de laboratoire: ${displayUrl}`,
            });
            return;
          }

          await FileSystem.copyAsync({
            from: sourceUri,
            to: destinationUri,
          });

          await Sharing.shareAsync(destinationUri, {
            mimeType: isPdf ? 'application/pdf' : 'image/jpeg',
            dialogTitle: 'Partager l\'analyse',
            UTI: isPdf ? 'com.adobe.pdf' : 'public.jpeg',
          });
        } catch (copyError) {
          await Share.share({
            message: `Analyse de laboratoire: ${displayUrl}`,
          });
        }
      } else {
        await Share.share({
          message: `Analyse de laboratoire: ${displayUrl}`,
        });
      }
    } catch (error) {
      console.error('[LabAnalysisViewer] Error sharing:', error);
      try {
        await Share.share({
          message: `Analyse de laboratoire: ${displayUrl ?? url}`,
        });
      } catch {
        Alert.alert('Erreur', 'Impossible de partager le document');
      }
    }
  };

  // Geste de pinch pour zoom
  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = savedScale.value * event.scale;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < 0.5) {
        scale.value = withSpring(0.5);
        savedScale.value = 0.5;
      } else if (scale.value > 4) {
        scale.value = withSpring(4);
        savedScale.value = 4;
      }
    });

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Zoom buttons
  const zoomIn = () => {
    const newScale = Math.min(scale.value * 1.5, 4);
    scale.value = withSpring(newScale);
    savedScale.value = newScale;
  };

  const zoomOut = () => {
    const newScale = Math.max(scale.value / 1.5, 0.5);
    scale.value = withSpring(newScale);
    savedScale.value = newScale;
  };

  return (
    <>
      {/* Bouton pour voir l'analyse */}
      <Pressable
        onPress={openViewer}
        className={compact ? "flex-row items-center px-2 py-1 rounded-full" : "flex-row items-center px-3 py-1.5 rounded-lg"}
        style={{
          backgroundColor: `${COLORS.accent.teal}20`,
          borderWidth: 1,
          borderColor: `${COLORS.accent.teal}40`,
        }}
      >
        <FileText size={compact ? 12 : 14} color={COLORS.accent.teal} />
        <Text
          style={{ color: COLORS.accent.teal }}
          className={compact ? "text-xs font-medium ml-1" : "text-xs font-semibold ml-1.5"}
        >
          {compact ? "Analyse" : "Voir l'analyse labo"}
        </Text>
      </Pressable>

      {/* Modal de visualisation */}
      <Modal
        visible={showViewer}
        animationType="fade"
        transparent
        onRequestClose={() => setShowViewer(false)}
      >
        <View className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}>
          {/* Header */}
          <View
            className="flex-row items-center justify-between px-4"
            style={{ paddingTop: insets.top + 8, paddingBottom: 12 }}
          >
            <Text style={{ color: COLORS.text.cream }} className="text-lg font-bold">
              Analyse de laboratoire
            </Text>
            <Pressable
              onPress={() => setShowViewer(false)}
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
            >
              <X size={22} color="#fff" />
            </Pressable>
          </View>

          {/* Contenu */}
          {isResolving && !displayUrl ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={COLORS.primary.gold} />
              <Text style={{ color: COLORS.text.cream }} className="mt-4">
                Chargement de l'analyse...
              </Text>
            </View>
          ) : resolveError && !displayUrl ? (
            <View className="flex-1 items-center justify-center px-6">
              <Text style={{ color: COLORS.text.cream }} className="text-lg font-bold text-center">
                {resolveError}
              </Text>
            </View>
          ) : isPdf ? (
            // Afficher le PDF directement
            <View className="flex-1">
              <PdfViewer uri={displayUrl} />
              {/* Bouton partager en bas */}
              <View
                className="absolute bottom-0 left-0 right-0 flex-row items-center justify-center py-4"
                style={{
                  paddingBottom: insets.bottom + 16,
                  backgroundColor: 'rgba(0,0,0,0.6)',
                }}
              >
                <Pressable
                  onPress={shareDocument}
                  className="flex-row items-center px-6 py-3 rounded-xl"
                  style={{ backgroundColor: COLORS.accent.teal }}
                >
                  <Share2 size={20} color="#fff" />
                  <Text style={{ color: '#fff' }} className="font-bold ml-2">
                    Partager
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            // Affichage Image avec zoom
            <View className="flex-1">
              <GestureDetector gesture={pinchGesture}>
                <View className="flex-1 items-center justify-center">
                  <Animated.Image
                    source={{ uri: displayUrl }}
                    style={[
                      {
                        width: SCREEN_WIDTH - 32,
                        height: SCREEN_HEIGHT * 0.6,
                      },
                      animatedImageStyle,
                    ]}
                    resizeMode="contain"
                  />
                </View>
              </GestureDetector>

              {/* Controles de zoom */}
              <View
                className="flex-row items-center justify-center gap-4 pb-4"
                style={{ paddingBottom: insets.bottom + 16 }}
              >
                <Pressable
                  onPress={zoomOut}
                  className="w-12 h-12 rounded-full items-center justify-center"
                  style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
                >
                  <ZoomOut size={22} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={shareDocument}
                  className="w-12 h-12 rounded-full items-center justify-center"
                  style={{ backgroundColor: COLORS.accent.teal }}
                >
                  <Share2 size={22} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={zoomIn}
                  className="w-12 h-12 rounded-full items-center justify-center"
                  style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
                >
                  <ZoomIn size={22} color="#fff" />
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}
