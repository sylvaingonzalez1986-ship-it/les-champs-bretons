/**
 * AudioContext - Contexte audio global pour l'app
 *
 * - Playlist des Chanvriers Bretons disponible dans l'onglet Musique
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Audio, AVPlaybackStatus, type AVPlaybackSource } from 'expo-av';
import { fetchMusicTracks, getSignedAudioUrl, getSignedCoverUrl, isMusicApiConfigured } from '@/lib/supabase-music';
import type { AudioSource } from '@/lib/types';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  audioSource: AudioSource; // require() ou { uri: string }
}

interface AudioContextType {
  // État de la playlist
  currentTrack: Track | null;
  currentTrackIndex: number;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  position: number; // en ms
  duration: number; // en ms
  tracks: Track[];
  isLoading: boolean;
  repeatMode: 'off' | 'one' | 'all';
  shuffleMode: boolean;

  // Actions playlist
  playTrack: (trackIndex: number) => Promise<void>;
  playPause: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;
  stop: () => Promise<void>;
  seekTo: (positionMs: number) => Promise<void>;
  loadTracks: (tracks: Track[]) => void;
  setRepeatMode: (mode: 'off' | 'one' | 'all') => void;
  toggleShuffle: () => void;
  refreshTracks: () => Promise<void>;
}

const AudioContext = createContext<AudioContextType | null>(null);

const AUDIO_FALLBACK: AudioContextType = {
  currentTrack: null,
  currentTrackIndex: 0,
  isPlaying: false,
  isMuted: false,
  volume: 0.5,
  position: 0,
  duration: 0,
  tracks: [],
  isLoading: false,
  repeatMode: 'off',
  shuffleMode: false,
  playTrack: async () => {},
  playPause: async () => {},
  nextTrack: async () => {},
  previousTrack: async () => {},
  setVolume: async () => {},
  toggleMute: async () => {},
  stop: async () => {},
  seekTo: async () => {},
  loadTracks: () => {},
  setRepeatMode: () => {},
  toggleShuffle: () => {},
  refreshTracks: async () => {},
};

// Variable globale pour éviter les réinitialisations multiples
let globalIsInitialized = false;

// Pistes de la playlist (disponibles dans l'onglet Musique)
const PLAYLIST_TRACKS: Track[] = [
  {
    id: 'track-1',
    title: 'Gloire aux Chanvriers Français',
    artist: 'Les Chanvriers Bretons',
    album: 'Album Chanvre',
    audioSource: require('../../assets/gloire-aux-chanvriers-francais.mp3'),
    coverUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400',
  },
  {
    id: 'track-2',
    title: 'Tranche de campagne',
    artist: 'Les Chanvriers Bretons',
    album: 'Album Chanvre',
    audioSource: require('../../assets/couplet-1.mp3'),
    coverUrl: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=400',
  },
  {
    id: 'track-3',
    title: 'Donne-moi l\'Or',
    artist: 'Les Chanvriers Bretons',
    album: 'Album Chanvre',
    audioSource: require('../../assets/les-chanvriers-bretons-donne-moi-lor.mp3'),
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400',
  },
  {
    id: 'track-4',
    title: 'En Feu',
    artist: 'Les Chanvriers Bretons',
    album: 'Album Chanvre',
    audioSource: require('../../assets/en-feu.mp3'),
    coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400',
  },
];

interface AudioProviderProps {
  children: React.ReactNode;
}

export function AudioProvider({ children }: AudioProviderProps) {
  // Ref pour le son de la playlist
  const playlistSoundRef = useRef<Audio.Sound | null>(null);

  // État de la playlist
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [tracks, setTracks] = useState<Track[]>(PLAYLIST_TRACKS);
  const [volume, setVolumeState] = useState(0.5);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'one' | 'all'>('all');
  const [shuffleMode, setShuffleMode] = useState(false);

  const isMountedRef = useRef(true);
  const handleNextTrackRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const currentTrack = tracks[currentTrackIndex] || null;

  // Callback pour la progression de la playlist
  const onPlaylistStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!isMountedRef.current) return;

    if (status.isLoaded) {
      setPosition(status.positionMillis);
      setDuration(status.durationMillis || 0);
      setIsPlaying(status.isPlaying);

      // Passer au suivant quand fini
      if (status.didJustFinish) {
        if (repeatMode === 'one') {
          playlistSoundRef.current?.replayAsync();
        } else if (repeatMode === 'all' || shuffleMode) {
          handleNextTrackRef.current?.();
        } else {
          // Playlist terminée
          setIsPlaying(false);
        }
      }
    }
  }, [repeatMode, shuffleMode]);

  // Nettoyer un son
  const cleanupSound = async (soundRef: React.MutableRefObject<Audio.Sound | null>) => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (e) {
        console.warn('[AudioContext] Error cleaning up sound:', e);
      }
      soundRef.current = null;
    }
  };

  // Jouer un morceau de la playlist
  const playTrackInternal = async (trackIndex: number, tracksToUse?: Track[]) => {
    if (!isMountedRef.current) return;

    const trackList = tracksToUse || tracks;
    const track = trackList[trackIndex];
    if (!track) {
      return;
    }

    setIsLoading(true);

    try {
      // Arrêter le morceau actuel de la playlist si existe
      await cleanupSound(playlistSoundRef);

      // Charger le nouveau morceau
      const { sound: newSound } = await Audio.Sound.createAsync(
        track.audioSource as AVPlaybackSource,
        {
          shouldPlay: true,
          volume: isMuted ? 0 : volume,
          isLooping: repeatMode === 'one',
        },
        onPlaylistStatusUpdate
      );

      if (!isMountedRef.current) {
        await newSound.unloadAsync();
        return;
      }

      playlistSoundRef.current = newSound;
      setCurrentTrackIndex(trackIndex);
      setIsPlaying(true);
    } catch (error) {
      console.error('[AudioContext] Error playing track:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Initialiser l'audio
  useEffect(() => {
    if (globalIsInitialized) {
      return;
    }
    globalIsInitialized = true;
    isMountedRef.current = true;

    const initAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
        });

        // Charger les pistes Supabase si configuré
        let allTracks: Track[] = [...PLAYLIST_TRACKS];

        if (isMusicApiConfigured()) {
          try {
            const supabaseTracks = await fetchMusicTracks();

            if (supabaseTracks.length > 0) {
              const convertedTracks: Track[] = await Promise.all(supabaseTracks.map(async (track) => {
                const coverUrl = track.cover_url
                  ? await getSignedCoverUrl(track.cover_url)
                  : 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400';
                const audioUrl = track.audio_url ? await getSignedAudioUrl(track.audio_url) : '';
                const resolvedAudioUrl = audioUrl || track.audio_url || '';
                return {
                  id: track.id,
                  title: track.title,
                  artist: track.artist,
                  album: track.album,
                  coverUrl,
                  audioSource: { uri: resolvedAudioUrl },
                };
              }));

              allTracks = [...PLAYLIST_TRACKS, ...convertedTracks];
            }
          } catch (err) {
            console.warn('[AudioContext] Error loading Supabase tracks:', err);
          }
        }

        if (isMountedRef.current) {
          setTracks(allTracks);
        }
      } catch (error) {
        console.warn('[AudioContext] Error initializing audio:', error);
      }
    };

    initAudio();

    return () => {
      isMountedRef.current = false;
      cleanupSound(playlistSoundRef);
    };
  }, []);

  // Morceau suivant
  const handleNextTrack = async () => {
    let nextIndex: number;
    if (shuffleMode) {
      nextIndex = Math.floor(Math.random() * tracks.length);
    } else {
      nextIndex = (currentTrackIndex + 1) % tracks.length;
    }
    await playTrackInternal(nextIndex);
  };

  handleNextTrackRef.current = handleNextTrack;

  // Actions exposées
  const playTrack = async (trackIndex: number) => {
    await playTrackInternal(trackIndex);
  };

  const playPause = async () => {
    if (!playlistSoundRef.current) {
      // Démarrer le premier morceau de la playlist
      if (tracks.length > 0) {
        await playTrackInternal(currentTrackIndex);
      }
      return;
    }

    try {
      if (isPlaying) {
        await playlistSoundRef.current.pauseAsync();
        setIsPlaying(false);
      } else {
        await playlistSoundRef.current.playAsync();
        setIsPlaying(true);
      }
    } catch (error) {
      console.warn('[AudioContext] Error toggling play/pause:', error);
    }
  };

  const nextTrack = async () => {
    await handleNextTrack();
  };

  const previousTrack = async () => {
    if (position > 3000 && playlistSoundRef.current) {
      await playlistSoundRef.current.setPositionAsync(0);
      return;
    }

    const prevIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
    await playTrackInternal(prevIndex);
  };

  const setVolume = async (newVolume: number) => {
    setVolumeState(newVolume);
    if (playlistSoundRef.current && !isMuted) {
      await playlistSoundRef.current.setVolumeAsync(newVolume);
    }
  };

  const toggleMute = async () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (playlistSoundRef.current) {
      await playlistSoundRef.current.setVolumeAsync(newMuted ? 0 : volume);
    }
  };

  const stop = async () => {
    await cleanupSound(playlistSoundRef);
    setIsPlaying(false);
    setPosition(0);
  };

  const seekTo = async (positionMs: number) => {
    if (playlistSoundRef.current) {
      await playlistSoundRef.current.setPositionAsync(positionMs);
    }
  };

  const loadTracks = (newTracks: Track[]) => {
    setTracks(newTracks);
  };

  const toggleShuffle = () => {
    setShuffleMode(!shuffleMode);
  };

  const refreshTracks = async () => {
    try {
      let allTracks: Track[] = [...PLAYLIST_TRACKS];

      if (isMusicApiConfigured()) {
        const supabaseTracks = await fetchMusicTracks();

        if (supabaseTracks.length > 0) {
          const convertedTracks: Track[] = await Promise.all(supabaseTracks.map(async (track) => {
            const coverUrl = track.cover_url
              ? await getSignedCoverUrl(track.cover_url)
              : 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400';
            const audioUrl = track.audio_url ? await getSignedAudioUrl(track.audio_url) : '';
            const resolvedAudioUrl = audioUrl || track.audio_url || '';
            return {
              id: track.id,
              title: track.title,
              artist: track.artist,
              album: track.album,
              coverUrl,
              audioSource: { uri: resolvedAudioUrl },
            };
          }));

          allTracks = [...PLAYLIST_TRACKS, ...convertedTracks];
        }
      }

      setTracks(allTracks);
    } catch (err) {
      console.warn('[AudioContext] Error refreshing tracks:', err);
    }
  };

  return (
    <AudioContext.Provider
      value={{
        currentTrack,
        currentTrackIndex,
        isPlaying,
        isMuted,
        volume,
        position,
        duration,
        tracks,
        isLoading,
        repeatMode,
        shuffleMode,
        playTrack,
        playPause,
        nextTrack,
        previousTrack,
        setVolume,
        toggleMute,
        stop,
        seekTo,
        loadTracks,
        setRepeatMode,
        toggleShuffle,
        refreshTracks,
      }}
    >
      {children}
    </AudioContext.Provider>
  );
}

export function AudioFallbackProvider({ children }: AudioProviderProps) {
  return (
    <AudioContext.Provider value={AUDIO_FALLBACK}>
      {children}
    </AudioContext.Provider>
  );
}

// Hook pour utiliser le contexte
export function useAudio() {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudio must be used within AudioProvider');
  }
  return context;
}
