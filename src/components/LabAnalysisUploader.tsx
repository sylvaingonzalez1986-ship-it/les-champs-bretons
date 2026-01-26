/**
 * LabAnalysisUploader - Composant pour uploader les analyses de laboratoire
 * Permet d'uploader un PDF ou de scanner un document avec la caméra
 * Inclut un visualiseur pour les documents uploadés
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Pressable,
  Modal,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Dimensions,
  Platform,
} from 'react-native';
import { Text } from '@/components/ui';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { WebView } from 'react-native-webview';
import {
  FileText,
  Camera,
  Upload,
  X,
  Trash2,
  Eye,
  ScanLine,
  Share2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react-native';
import { COLORS } from '@/lib/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

      // Sur le web, on utilise directement l'URL
      if (Platform.OS === 'web') {
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
        try {
          await FileSystem.copyAsync({
            from: sourceUri,
            to: destUri,
          });
          base64Data = await FileSystem.readAsStringAsync(destUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } catch (copyError) {
          console.log('[PdfViewer] Copy failed, trying with original URI:', copyError);

          // Essayer avec l'URI originale
          try {
            await FileSystem.copyAsync({
              from: uri,
              to: destUri,
            });
            base64Data = await FileSystem.readAsStringAsync(destUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
          } catch (secondError) {
            console.log('[PdfViewer] Second copy attempt failed:', secondError);

            // Dernier recours: essayer de lire directement
            try {
              base64Data = await FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.Base64,
              });
            } catch (readError) {
              console.log('[PdfViewer] Direct read failed:', readError);
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

  // Sur le web, afficher avec Google Docs Viewer
  if (Platform.OS === 'web') {
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

  // Afficher le PDF avec WebView en utilisant un viewer HTML/JS
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

interface LabAnalysisUploaderProps {
  value?: string | null; // URL du document existant
  onUpload: (uri: string, fileName: string, mimeType: string) => void;
  onRemove: () => void;
  uploading?: boolean;
}

export function LabAnalysisUploader({
  value,
  onUpload,
  onRemove,
  uploading = false,
}: LabAnalysisUploaderProps) {
  const insets = useSafeAreaInsets();
  const [showCamera, setShowCamera] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);

  // Zoom pour la visualisation d'image
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  // Sélectionner un PDF depuis le téléphone
  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets.length > 0) {
        const file = result.assets[0];
        console.log('[LabAnalysis] File selected:', file.uri);

        // Sur Android, lire immédiatement le fichier en base64 et le sauvegarder
        // car le fichier temporaire du DocumentPicker peut expirer
        const fileName = `lab_analysis_${Date.now()}.pdf`;
        const destUri = `${FileSystem.documentDirectory}${fileName}`;

        try {
          // Lire le fichier en base64 immédiatement (avant qu'il n'expire)
          const base64Content = await FileSystem.readAsStringAsync(file.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });

          // Écrire le contenu dans un fichier permanent
          await FileSystem.writeAsStringAsync(destUri, base64Content, {
            encoding: FileSystem.EncodingType.Base64,
          });

          console.log('[LabAnalysis] File saved to:', destUri);
          onUpload(destUri, file.name, file.mimeType || 'application/pdf');
        } catch (readWriteError) {
          console.log('[LabAnalysis] Read/Write failed, trying copy:', readWriteError);

          // Fallback: essayer la copie directe
          try {
            await FileSystem.copyAsync({
              from: file.uri,
              to: destUri,
            });
            console.log('[LabAnalysis] Copy succeeded to:', destUri);
            onUpload(destUri, file.name, file.mimeType || 'application/pdf');
          } catch (copyError) {
            console.log('[LabAnalysis] Copy also failed:', copyError);
            // Dernier recours: utiliser l'URI originale (peut ne pas fonctionner plus tard)
            onUpload(file.uri, file.name, file.mimeType || 'application/pdf');
            Alert.alert(
              'Attention',
              'Le fichier a été sélectionné mais pourrait ne pas être accessible plus tard. Veuillez réessayer si le PDF ne s\'affiche pas.'
            );
          }
        }
      }
    } catch (error) {
      console.error('[LabAnalysis] Error picking document:', error);
      Alert.alert('Erreur', 'Impossible de sélectionner le document');
    }
  };

  // Scanner un document avec la caméra
  const openScanner = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        Alert.alert(
          'Permission requise',
          'Veuillez autoriser l\'accès à la caméra pour scanner des documents'
        );
        return;
      }
    }
    setShowCamera(true);
  };

  // Prendre une photo du document
  const captureDocument = async () => {
    if (!cameraRef.current || capturing) return;

    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
      });

      if (photo?.uri) {
        const fileName = `analyse_labo_${Date.now()}.jpg`;
        onUpload(photo.uri, fileName, 'image/jpeg');
        setShowCamera(false);
      }
    } catch (error) {
      console.error('[LabAnalysis] Error capturing:', error);
      Alert.alert('Erreur', 'Impossible de capturer l\'image');
    } finally {
      setCapturing(false);
    }
  };

  // Sélectionner une image depuis la galerie
  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        const fileName = asset.fileName || `analyse_labo_${Date.now()}.jpg`;
        onUpload(asset.uri, fileName, asset.mimeType || 'image/jpeg');
      }
    } catch (error) {
      console.error('[LabAnalysis] Error picking image:', error);
      Alert.alert('Erreur', 'Impossible de sélectionner l\'image');
    }
  };

  // Ouvrir le visualiseur
  const openViewer = () => {
    if (!value) return;

    // Reset zoom
    scale.value = 1;
    savedScale.value = 1;
    setShowViewer(true);
  };

  // Partager le document
  const shareDocument = async () => {
    if (!value) return;

    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Partage', 'Le partage n\'est pas disponible sur cet appareil');
        return;
      }

      // Pour les fichiers locaux (file://), on doit les copier dans un répertoire accessible
      if (value.startsWith('file://') || value.startsWith('/data/')) {
        const FileSystem = await import('expo-file-system');

        // Déterminer l'extension du fichier
        const extension = isPdf ? '.pdf' : '.jpg';
        const fileName = `analyse_labo_${Date.now()}${extension}`;
        const destinationUri = `${FileSystem.cacheDirectory}${fileName}`;

        // Copier le fichier vers le cache accessible
        const sourceUri = value.startsWith('file://') ? value : `file://${value}`;
        await FileSystem.copyAsync({
          from: sourceUri,
          to: destinationUri,
        });

        // Partager depuis le cache
        await Sharing.shareAsync(destinationUri, {
          mimeType: isPdf ? 'application/pdf' : 'image/jpeg',
          dialogTitle: 'Partager l\'analyse',
          UTI: isPdf ? 'com.adobe.pdf' : 'public.jpeg',
        });
      } else {
        // Pour les URLs HTTP, partager directement
        await Sharing.shareAsync(value);
      }
    } catch (error) {
      console.error('[LabAnalysis] Error sharing:', error);
      Alert.alert('Erreur', 'Impossible de partager le document. Essayez de resélectionner le fichier.');
    }
  };

  // Déterminer si c'est un PDF ou une image
  const isPdf = value?.toLowerCase().endsWith('.pdf') || value?.includes('application/pdf');
  const hasDocument = !!value;

  // Geste de pinch pour zoom
  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = savedScale.value * event.scale;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      // Limiter le zoom entre 0.5 et 4
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

  // Zoom in/out buttons
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

  const resetZoom = () => {
    scale.value = withSpring(1);
    savedScale.value = 1;
  };

  return (
    <View className="mb-4">
      <Text style={{ color: COLORS.text.lightGray }} className="font-medium mb-2">
        Analyse de laboratoire
      </Text>

      {/* Document existant */}
      {hasDocument && (
        <View
          className="flex-row items-center p-3 rounded-xl mb-3"
          style={{
            backgroundColor: `${COLORS.accent.teal}15`,
            borderWidth: 1,
            borderColor: `${COLORS.accent.teal}40`,
          }}
        >
          <View
            className="w-12 h-12 rounded-xl items-center justify-center mr-3"
            style={{ backgroundColor: `${COLORS.accent.teal}25` }}
          >
            <FileText size={24} color={COLORS.accent.teal} />
          </View>
          <View className="flex-1">
            <Text style={{ color: COLORS.text.cream }} className="font-medium">
              {isPdf ? 'Document PDF' : 'Image du document'}
            </Text>
            <Text style={{ color: COLORS.accent.teal }} className="text-xs">
              Analyse uploadée
            </Text>
          </View>
          <View className="flex-row">
            <Pressable
              onPress={openViewer}
              className="p-2 rounded-lg mr-2"
              style={{ backgroundColor: `${COLORS.accent.sky}20` }}
            >
              <Eye size={18} color={COLORS.accent.sky} />
            </Pressable>
            <Pressable
              onPress={onRemove}
              className="p-2 rounded-lg"
              style={{ backgroundColor: `${COLORS.accent.red}20` }}
            >
              <Trash2 size={18} color={COLORS.accent.red} />
            </Pressable>
          </View>
        </View>
      )}

      {/* Indicateur de chargement */}
      {uploading && (
        <View
          className="flex-row items-center justify-center p-4 rounded-xl mb-3"
          style={{ backgroundColor: `${COLORS.primary.gold}15` }}
        >
          <ActivityIndicator color={COLORS.primary.gold} />
          <Text style={{ color: COLORS.primary.gold }} className="ml-3">
            Upload en cours...
          </Text>
        </View>
      )}

      {/* Boutons d'action */}
      {!uploading && (
        <View className="flex-row gap-2">
          {/* Scanner avec caméra */}
          <Pressable
            onPress={openScanner}
            className="flex-1 flex-row items-center justify-center py-3 rounded-xl"
            style={{
              backgroundColor: COLORS.primary.gold,
            }}
          >
            <ScanLine size={18} color={COLORS.text.dark} />
            <Text style={{ color: COLORS.text.dark }} className="font-bold ml-2">
              Scanner
            </Text>
          </Pressable>

          {/* Sélectionner un PDF */}
          <Pressable
            onPress={pickDocument}
            className="flex-1 flex-row items-center justify-center py-3 rounded-xl"
            style={{
              backgroundColor: `${COLORS.accent.teal}20`,
              borderWidth: 2,
              borderColor: COLORS.accent.teal,
            }}
          >
            <Upload size={18} color={COLORS.accent.teal} />
            <Text style={{ color: COLORS.accent.teal }} className="font-bold ml-2">
              PDF
            </Text>
          </Pressable>

          {/* Sélectionner depuis galerie */}
          <Pressable
            onPress={pickFromGallery}
            className="flex-1 flex-row items-center justify-center py-3 rounded-xl"
            style={{
              backgroundColor: `${COLORS.accent.sky}20`,
              borderWidth: 2,
              borderColor: COLORS.accent.sky,
            }}
          >
            <FileText size={18} color={COLORS.accent.sky} />
            <Text style={{ color: COLORS.accent.sky }} className="font-bold ml-2">
              Image
            </Text>
          </Pressable>
        </View>
      )}

      {/* Info */}
      <Text style={{ color: COLORS.text.muted }} className="text-xs mt-2">
        Formats acceptés: PDF, JPG, PNG. Scannez ou uploadez l'analyse de votre produit.
      </Text>

      {/* Modal Visualiseur de document */}
      <Modal
        visible={showViewer}
        animationType="fade"
        onRequestClose={() => setShowViewer(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {/* Header */}
          <View
            className="flex-row items-center justify-between px-4"
            style={{
              paddingTop: insets.top + 10,
              paddingBottom: 15,
              backgroundColor: 'rgba(0,0,0,0.8)',
            }}
          >
            <Pressable
              onPress={() => setShowViewer(false)}
              className="p-3 rounded-full"
              style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
            >
              <X size={24} color="#fff" />
            </Pressable>

            <Text style={{ color: '#fff' }} className="text-lg font-bold">
              {isPdf ? 'Document PDF' : 'Analyse'}
            </Text>

            <Pressable
              onPress={shareDocument}
              className="p-3 rounded-full"
              style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
            >
              <Share2 size={24} color="#fff" />
            </Pressable>
          </View>

          {/* Contenu */}
          {isPdf ? (
            // Afficher le PDF avec WebView
            <View className="flex-1">
              <PdfViewer uri={value || ''} />
              {/* Bouton partager en bas */}
              <View
                className="absolute bottom-0 left-0 right-0 flex-row items-center justify-center py-4"
                style={{
                  paddingBottom: insets.bottom + 20,
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
            // Pour les images, afficher avec zoom
            <View className="flex-1">
              <GestureDetector gesture={pinchGesture}>
                <ScrollView
                  contentContainerStyle={{
                    flex: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                  maximumZoomScale={4}
                  minimumZoomScale={0.5}
                  showsVerticalScrollIndicator={false}
                  showsHorizontalScrollIndicator={false}
                >
                  <Animated.Image
                    source={{ uri: value || '' }}
                    style={[
                      {
                        width: SCREEN_WIDTH,
                        height: SCREEN_HEIGHT * 0.7,
                      },
                      animatedImageStyle,
                    ]}
                    resizeMode="contain"
                  />
                </ScrollView>
              </GestureDetector>

              {/* Contrôles de zoom */}
              <View
                className="absolute bottom-0 left-0 right-0 flex-row items-center justify-center gap-4 py-4"
                style={{
                  paddingBottom: insets.bottom + 20,
                  backgroundColor: 'rgba(0,0,0,0.6)',
                }}
              >
                <Pressable
                  onPress={zoomOut}
                  className="w-12 h-12 rounded-full items-center justify-center"
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                >
                  <ZoomOut size={24} color="#fff" />
                </Pressable>

                <Pressable
                  onPress={resetZoom}
                  className="px-4 py-2 rounded-full"
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                >
                  <Text style={{ color: '#fff' }} className="font-medium">
                    100%
                  </Text>
                </Pressable>

                <Pressable
                  onPress={zoomIn}
                  className="w-12 h-12 rounded-full items-center justify-center"
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                >
                  <ZoomIn size={24} color="#fff" />
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Modal Caméra pour scanner */}
      <Modal
        visible={showCamera}
        animationType="slide"
        onRequestClose={() => setShowCamera(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            facing="back"
          >
            {/* Overlay guide */}
            <View style={{ flex: 1 }}>
              {/* Header */}
              <View
                className="flex-row items-center justify-between px-4"
                style={{
                  paddingTop: insets.top + 10,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                }}
              >
                <Pressable
                  onPress={() => setShowCamera(false)}
                  className="p-3 rounded-full"
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                >
                  <X size={24} color="#fff" />
                </Pressable>
                <Text style={{ color: '#fff' }} className="text-lg font-bold">
                  Scanner le document
                </Text>
                <View style={{ width: 48 }} />
              </View>

              {/* Zone centrale avec cadre */}
              <View className="flex-1 items-center justify-center">
                <View
                  style={{
                    width: '85%',
                    aspectRatio: 0.7,
                    borderWidth: 3,
                    borderColor: COLORS.primary.gold,
                    borderRadius: 12,
                  }}
                >
                  {/* Coins décoratifs */}
                  <View
                    style={{
                      position: 'absolute',
                      top: -3,
                      left: -3,
                      width: 30,
                      height: 30,
                      borderTopWidth: 6,
                      borderLeftWidth: 6,
                      borderColor: COLORS.primary.brightYellow,
                      borderTopLeftRadius: 12,
                    }}
                  />
                  <View
                    style={{
                      position: 'absolute',
                      top: -3,
                      right: -3,
                      width: 30,
                      height: 30,
                      borderTopWidth: 6,
                      borderRightWidth: 6,
                      borderColor: COLORS.primary.brightYellow,
                      borderTopRightRadius: 12,
                    }}
                  />
                  <View
                    style={{
                      position: 'absolute',
                      bottom: -3,
                      left: -3,
                      width: 30,
                      height: 30,
                      borderBottomWidth: 6,
                      borderLeftWidth: 6,
                      borderColor: COLORS.primary.brightYellow,
                      borderBottomLeftRadius: 12,
                    }}
                  />
                  <View
                    style={{
                      position: 'absolute',
                      bottom: -3,
                      right: -3,
                      width: 30,
                      height: 30,
                      borderBottomWidth: 6,
                      borderRightWidth: 6,
                      borderColor: COLORS.primary.brightYellow,
                      borderBottomRightRadius: 12,
                    }}
                  />
                </View>
                <Text
                  style={{ color: '#fff' }}
                  className="text-center mt-4 px-8"
                >
                  Placez le document dans le cadre
                </Text>
              </View>

              {/* Bouton capture */}
              <View
                className="items-center pb-10"
                style={{
                  paddingBottom: insets.bottom + 30,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                }}
              >
                <Pressable
                  onPress={captureDocument}
                  disabled={capturing}
                  className="w-20 h-20 rounded-full items-center justify-center"
                  style={{
                    backgroundColor: capturing ? COLORS.text.muted : COLORS.primary.gold,
                    borderWidth: 4,
                    borderColor: '#fff',
                  }}
                >
                  {capturing ? (
                    <ActivityIndicator color={COLORS.text.dark} />
                  ) : (
                    <Camera size={32} color={COLORS.text.dark} />
                  )}
                </Pressable>
                <Text style={{ color: '#fff' }} className="mt-3 text-sm">
                  Appuyez pour capturer
                </Text>
              </View>
            </View>
          </CameraView>
        </View>
      </Modal>
    </View>
  );
}
