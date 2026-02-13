import type { ConfigContext, ExpoConfig } from 'expo/config';

const IOS_BUNDLE_IDENTIFIER = 'com.sylvain.x35.chanvriers';
const ANDROID_PACKAGE = 'com.sylvain.x35.chanvriers';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'chanvriers',
  slug: config.slug ?? 'chanvriers',
  version: config.version ?? '1.0.0',
  ios: {
    ...(config.ios ?? {}),
    bundleIdentifier: config.ios?.bundleIdentifier ?? IOS_BUNDLE_IDENTIFIER,
    infoPlist: {
      ...(config.ios?.infoPlist ?? {}),
      NSCameraUsageDescription:
        "Permet de prendre des photos et scanner des documents pour les fiches produits et analyses.",
      NSPhotoLibraryUsageDescription:
        "Permet de sélectionner des photos et documents depuis votre photothèque.",
      NSPhotoLibraryAddUsageDescription:
        "Permet d'enregistrer des images et documents générés par l'application.",
      NSMicrophoneUsageDescription:
        "Permet d'utiliser le microphone pour les fonctionnalités audio et vidéo lorsque nécessaire.",
      NSContactsUsageDescription:
        "Permet d'accéder à vos contacts pour faciliter certains partages et interactions.",
      NSLocationWhenInUseUsageDescription:
        "Permet d'afficher les producteurs proches et améliorer l'expérience locale.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Permet de continuer à proposer des données locales pertinentes selon votre position.",
      NSLocationAlwaysUsageDescription:
        "Permet de continuer à proposer des données locales pertinentes selon votre position.",
      NSCalendarsUsageDescription:
        "Permet d'ajouter des rappels et événements liés à vos commandes et disponibilités.",
      NSRemindersUsageDescription:
        "Permet de créer des rappels utiles pour le suivi de vos commandes.",
      NSCalendarsFullAccessUsageDescription:
        "Permet d'intégrer pleinement les événements utiles dans votre calendrier.",
      NSRemindersFullAccessUsageDescription:
        "Permet d'intégrer pleinement les rappels utiles dans votre application Rappels.",
      NSMotionUsageDescription:
        "Permet d'améliorer certains effets d'interface basés sur le mouvement de l'appareil.",
    },
  },
  android: {
    ...(config.android ?? {}),
    package: config.android?.package ?? ANDROID_PACKAGE,
  },
});
