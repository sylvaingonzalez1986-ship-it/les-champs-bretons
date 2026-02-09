/**
 * Audio store - single source of truth for app audio.
 * Replaces AudioContext with a Zustand store.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio, AVPlaybackStatus, type AVPlaybackSource } from 'expo-av';
import { fetchMusicTracks, getSignedAudioUrl, getSignedCoverUrl, isMusicApiConfigured } from '@/lib/supabase-music';
import type { AudioSource } from '@/lib/types';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  audioSource: AudioSource; // require() or { uri: string }
}

const PLAYLIST_TRACKS: Track[] = [
  {
    id: 'track-1',
    title: 'Gloire aux Chanvriers Français',
    artist: 'Les Chanvriers Bretons',
    album: 'Album Chanvre',
    audioSource: require('../../../assets/gloire-aux-chanvriers-francais.mp3'),
    coverUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400',
  },
  {
    id: 'track-2',
    title: 'Tranche de campagne',
    artist: 'Les Chanvriers Bretons',
    album: 'Album Chanvre',
    audioSource: require('../../../assets/couplet-1.mp3'),
    coverUrl: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=400',
  },
  {
    id: 'track-3',
    title: "Donne-moi l'Or",
    artist: 'Les Chanvriers Bretons',
    album: 'Album Chanvre',
    audioSource: require('../../../assets/les-chanvriers-bretons-donne-moi-lor.mp3'),
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400',
  },
  {
    id: 'track-4',
    title: 'En Feu',
    artist: 'Les Chanvriers Bretons',
    album: 'Album Chanvre',
    audioSource: require('../../../assets/en-feu.mp3'),
    coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400',
  },
];

interface AudioState {
  tracks: Track[];
  currentTrackIndex: number;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  position: number; // ms
  duration: number; // ms
  isLoading: boolean;
  repeatMode: 'off' | 'one' | 'all';
  shuffleMode: boolean;
  soundRef: Audio.Sound | null;
  initialized: boolean;
  initializing: boolean;

  initialize: () => Promise<void>;
  destroy: () => Promise<void>;
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

async function cleanupSound(sound: Audio.Sound | null) {
  if (!sound) return;
  try {
    await sound.stopAsync();
    await sound.unloadAsync();
  } catch (error) {
    console.warn('[AudioStore] Error cleaning up sound:', error);
  }
}

export const useAudioStore = create<AudioState>()(
  persist(
    (set, get) => {
      const handleStatusUpdate = (status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;

        set({
          position: status.positionMillis,
          duration: status.durationMillis || 0,
          isPlaying: status.isPlaying,
        });

        if (status.didJustFinish) {
          const repeatMode = get().repeatMode;
          const shuffleMode = get().shuffleMode;
          const soundRef = get().soundRef;

          if (repeatMode === 'one') {
            void soundRef?.replayAsync();
          } else if (repeatMode === 'all' || shuffleMode) {
            void get().nextTrack();
          } else {
            set({ isPlaying: false });
          }
        }
      };

      const playTrackInternal = async (trackIndex: number) => {
        const state = get();
        const track = state.tracks[trackIndex];
        if (!track) return;

        set({ isLoading: true });
        await cleanupSound(state.soundRef);
        set({ soundRef: null });

        try {
          const { sound } = await Audio.Sound.createAsync(
            track.audioSource as AVPlaybackSource,
            {
              shouldPlay: true,
              volume: state.isMuted ? 0 : state.volume,
              isLooping: state.repeatMode === 'one',
            },
            handleStatusUpdate
          );

          set({
            soundRef: sound,
            currentTrackIndex: trackIndex,
            isPlaying: true,
          });
        } catch (error) {
          console.error('[AudioStore] Error playing track:', error);
        } finally {
          set({ isLoading: false });
        }
      };

      return {
        tracks: PLAYLIST_TRACKS,
        currentTrackIndex: 0,
        isPlaying: false,
        isMuted: false,
        volume: 0.5,
        position: 0,
        duration: 0,
        isLoading: false,
        repeatMode: 'all',
        shuffleMode: false,
        soundRef: null,
        initialized: false,
        initializing: false,

        initialize: async () => {
          const { initialized, initializing } = get();
          if (initialized || initializing) return;

          set({ initializing: true });

          try {
            await Audio.setAudioModeAsync({
              allowsRecordingIOS: false,
              playsInSilentModeIOS: true,
              staysActiveInBackground: true,
              shouldDuckAndroid: true,
            });

            let allTracks: Track[] = [...PLAYLIST_TRACKS];

            if (isMusicApiConfigured()) {
              try {
                const supabaseTracks = await fetchMusicTracks();
                if (supabaseTracks.length > 0) {
                  const convertedTracks: Track[] = await Promise.all(
                    supabaseTracks.map(async (track) => {
                      const coverUrl = track.cover_url
                        ? await getSignedCoverUrl(track.cover_url)
                        : 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400';
                      const audioUrl = track.audio_url
                        ? await getSignedAudioUrl(track.audio_url)
                        : '';
                      const resolvedAudioUrl = audioUrl || track.audio_url || '';

                      return {
                        id: track.id,
                        title: track.title,
                        artist: track.artist,
                        album: track.album,
                        coverUrl,
                        audioSource: { uri: resolvedAudioUrl },
                      };
                    })
                  );

                  allTracks = [...PLAYLIST_TRACKS, ...convertedTracks];
                }
              } catch (error) {
                console.warn('[AudioStore] Error loading Supabase tracks:', error);
              }
            }

            set({ tracks: allTracks, initialized: true });
          } catch (error) {
            console.warn('[AudioStore] Error initializing audio:', error);
          } finally {
            set({ initializing: false });
          }
        },

        destroy: async () => {
          const { soundRef } = get();
          await cleanupSound(soundRef);
          set({ soundRef: null, isPlaying: false, position: 0 });
        },

        playTrack: async (trackIndex: number) => {
          await playTrackInternal(trackIndex);
        },

        playPause: async () => {
          const { soundRef, isPlaying, currentTrackIndex, tracks } = get();
          if (!soundRef) {
            if (tracks.length > 0) {
              await playTrackInternal(currentTrackIndex);
            }
            return;
          }

          try {
            if (isPlaying) {
              await soundRef.pauseAsync();
              set({ isPlaying: false });
            } else {
              await soundRef.playAsync();
              set({ isPlaying: true });
            }
          } catch (error) {
            console.warn('[AudioStore] Error toggling play/pause:', error);
          }
        },

        nextTrack: async () => {
          const state = get();
          const trackCount = state.tracks.length;
          if (trackCount === 0) return;

          const nextIndex = state.shuffleMode
            ? Math.floor(Math.random() * trackCount)
            : (state.currentTrackIndex + 1) % trackCount;

          await playTrackInternal(nextIndex);
        },

        previousTrack: async () => {
          const state = get();
          const trackCount = state.tracks.length;
          if (trackCount === 0) return;

          if (state.position > 3000 && state.soundRef) {
            await state.soundRef.setPositionAsync(0);
            return;
          }

          const prevIndex = (state.currentTrackIndex - 1 + trackCount) % trackCount;
          await playTrackInternal(prevIndex);
        },

        setVolume: async (volume: number) => {
          set({ volume });
          const { soundRef, isMuted } = get();
          if (soundRef && !isMuted) {
            await soundRef.setVolumeAsync(volume);
          }
        },

        toggleMute: async () => {
          const { isMuted, soundRef, volume } = get();
          const nextMuted = !isMuted;
          set({ isMuted: nextMuted });

          if (soundRef) {
            await soundRef.setVolumeAsync(nextMuted ? 0 : volume);
          }
        },

        stop: async () => {
          const { soundRef } = get();
          await cleanupSound(soundRef);
          set({ soundRef: null, isPlaying: false, position: 0 });
        },

        seekTo: async (positionMs: number) => {
          const { soundRef } = get();
          if (soundRef) {
            await soundRef.setPositionAsync(positionMs);
          }
        },

        loadTracks: (tracks: Track[]) => set({ tracks }),

        setRepeatMode: (mode: 'off' | 'one' | 'all') => set({ repeatMode: mode }),

        toggleShuffle: () => set((state) => ({ shuffleMode: !state.shuffleMode })),

        refreshTracks: async () => {
          try {
            let allTracks: Track[] = [...PLAYLIST_TRACKS];

            if (isMusicApiConfigured()) {
              const supabaseTracks = await fetchMusicTracks();

              if (supabaseTracks.length > 0) {
                const convertedTracks: Track[] = await Promise.all(
                  supabaseTracks.map(async (track) => {
                    const coverUrl = track.cover_url
                      ? await getSignedCoverUrl(track.cover_url)
                      : 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400';
                    const audioUrl = track.audio_url
                      ? await getSignedAudioUrl(track.audio_url)
                      : '';
                    const resolvedAudioUrl = audioUrl || track.audio_url || '';

                    return {
                      id: track.id,
                      title: track.title,
                      artist: track.artist,
                      album: track.album,
                      coverUrl,
                      audioSource: { uri: resolvedAudioUrl },
                    };
                  })
                );

                allTracks = [...PLAYLIST_TRACKS, ...convertedTracks];
              }
            }

            set({ tracks: allTracks });
          } catch (error) {
            console.warn('[AudioStore] Error refreshing tracks:', error);
          }
        },
      };
    },
    {
      name: 'audio-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        currentTrackIndex: state.currentTrackIndex,
        volume: state.volume,
        isMuted: state.isMuted,
        repeatMode: state.repeatMode,
        shuffleMode: state.shuffleMode,
      }),
    }
  )
);
