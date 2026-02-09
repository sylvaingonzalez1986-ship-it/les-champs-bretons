import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Farming Game Store
export type CropType = 'outdoor' | 'greenhouse' | 'indoor';
export type PlotState = 'empty' | 'planted' | 'growing' | 'ready';

export interface FarmPlot {
  id: string;
  state: PlotState;
  cropType: CropType | null;
  plantedAt: number | null;
  growthDuration: number; // in milliseconds
  unlocked: boolean;
  waterLevel: number; // 0-100%
  lastWaterUpdate: number | null; // timestamp
  // Light system
  lightOn: boolean;
  lightChangedAt: number | null; // timestamp when light was last toggled
  lightPenalty: number; // accumulated quality penalty %
  // Pruning system (taille)
  pruneCount: number; // 0-3 prunings done
  pruneBonus: number; // accumulated yield bonus/malus from pruning (can be negative)
  // Watering tracking for yield calculation
  wateringScore: number; // 0-100, tracks how well watered (100 = perfect)
  totalWaterings: number; // count of times watered
  timesWaterCritical: number; // count of times water went below 30%
}

// Harvest result interface for displaying to user
export interface HarvestResult {
  grams: number;
  xpGained: number;
  waterMultiplier: number;
  lightMultiplier: number;
  pruneBonus: number;
  baseGrams: number;
  quality: 'parfait' | 'bon' | 'moyen' | 'faible';
}

export interface CropLevel {
  level: number; // 1-5
  experience: number;
  experienceToNextLevel: number;
}

export interface FarmingGameState {
  coins: number;
  plots: FarmPlot[];
  cropLevels: Record<CropType, CropLevel>;
  harvestedCrops: Record<CropType, number>;
  totalHarvests: number;
}

// Time scale configurations
// Normal mode: 1 heure virtuelle = 1 jour réel
// Admin mode: 1 mois réel = 1 minute virtuelle (accelerated for testing)
// Admin acceleration factor: 30 days * 24 hours * 60 = 43200x faster
export const ADMIN_TIME_SCALE = 43200; // 1 month = 1 minute

// Normal growth times (in ms)
const NORMAL_GROWTH_OUTDOOR = 648000000; // 180 heures (6 mois)
const NORMAL_GROWTH_GREENHOUSE = 648000000; // 180 heures (6 mois)
const NORMAL_GROWTH_INDOOR = 324000000; // 90 heures (3 mois)

// Admin growth times (in ms) - 6 mois = 6 min, 3 mois = 3 min
const ADMIN_GROWTH_OUTDOOR = 6 * 60 * 1000; // 6 minutes
const ADMIN_GROWTH_GREENHOUSE = 6 * 60 * 1000; // 6 minutes
const ADMIN_GROWTH_INDOOR = 3 * 60 * 1000; // 3 minutes

// Function to get growth time based on admin mode
export const getGrowthTime = (cropType: CropType, isAdmin: boolean): number => {
  if (isAdmin) {
    switch (cropType) {
      case 'outdoor': return ADMIN_GROWTH_OUTDOOR;
      case 'greenhouse': return ADMIN_GROWTH_GREENHOUSE;
      case 'indoor': return ADMIN_GROWTH_INDOOR;
    }
  }
  switch (cropType) {
    case 'outdoor': return NORMAL_GROWTH_OUTDOOR;
    case 'greenhouse': return NORMAL_GROWTH_GREENHOUSE;
    case 'indoor': return NORMAL_GROWTH_INDOOR;
  }
};

// Light cycle times
export const NORMAL_LIGHT_CYCLE_MS = 12 * 60 * 60 * 1000; // 12 heures
export const ADMIN_LIGHT_CYCLE_MS = 12 * 1000; // 12 seconds for admin

// Water decay rates
export const NORMAL_WATER_DECAY_RATE = 50 / (2 * 60 * 60 * 1000); // 50% per 2 hours
export const ADMIN_WATER_DECAY_RATE = 50 / (2 * 60 * 1000); // 50% per 2 minutes for admin

export const CROP_CONFIG: Record<CropType, {
  name: string;
  icon: string;
  growthTime: number;
  baseReward: number;
  baseXp: number;
  color: string;
  description: string;
  cost: number;
}> = {
  outdoor: {
    name: 'Outdoor',
    icon: '☀️',
    growthTime: 648000000, // 180 heures (6 mois réels = 180 jours, 1h virtuelle = 1 jour réel)
    baseReward: 10,
    baseXp: 10,
    color: '#5A9E5A',
    description: 'Culture en plein air - 6 mois',
    cost: 5,
  },
  greenhouse: {
    name: 'Greenhouse',
    icon: '🏡',
    growthTime: 648000000, // 180 heures (6 mois réels = 180 jours, 1h virtuelle = 1 jour réel)
    baseReward: 25,
    baseXp: 15,
    color: '#4A9B9B',
    description: 'Culture sous serre - 6 mois',
    cost: 15,
  },
  indoor: {
    name: 'Indoor',
    icon: '💡',
    growthTime: 324000000, // 90 heures (3 mois réels = 90 jours, 1h virtuelle = 1 jour réel)
    baseReward: 50,
    baseXp: 25,
    color: '#8B5CF6',
    description: 'Culture en intérieur - 3 mois',
    cost: 30,
  },
};

// Reward multiplier per level (1-5)
export const LEVEL_MULTIPLIERS = [1, 1.5, 2, 2.5, 3];

// XP required to reach next level for each crop
const calculateCropXpToNextLevel = (level: number): number => {
  if (level >= 5) return 0; // Max level
  return Math.floor(50 * Math.pow(1.8, level - 1));
};

// Get reward for a crop at a specific level
export const getCropReward = (cropType: CropType, level: number): number => {
  const baseReward = CROP_CONFIG[cropType].baseReward;
  const multiplier = LEVEL_MULTIPLIERS[Math.min(level - 1, 4)] ?? 1;
  return Math.floor(baseReward * multiplier);
};

const createInitialCropLevels = (): Record<CropType, CropLevel> => ({
  outdoor: { level: 1, experience: 0, experienceToNextLevel: 50 },
  greenhouse: { level: 1, experience: 0, experienceToNextLevel: 50 },
  indoor: { level: 1, experience: 0, experienceToNextLevel: 50 },
});

const createInitialPlots = (): FarmPlot[] => {
  const plots: FarmPlot[] = [];
  for (let i = 0; i < 12; i++) {
    plots.push({
      id: `plot-${i}`,
      state: 'empty',
      cropType: null,
      plantedAt: null,
      growthDuration: 0,
      unlocked: i < 4, // First 4 plots unlocked by default
      waterLevel: 100,
      lastWaterUpdate: null,
      lightOn: true,
      lightChangedAt: null,
      lightPenalty: 0,
      pruneCount: 0,
      pruneBonus: 0,
      wateringScore: 100,
      totalWaterings: 0,
      timesWaterCritical: 0,
    });
  }
  return plots;
};

interface FarmingStore extends FarmingGameState {
  plantCrop: (plotId: string, cropType: CropType, isAdmin?: boolean) => void;
  harvestCrop: (plotId: string) => HarvestResult | null;
  unlockPlot: (plotId: string) => boolean;
  addCoins: (amount: number) => void;
  updatePlotGrowth: (plotId: string) => void;
  getPlotUnlockCost: (plotIndex: number) => number;
  waterPlot: (plotId: string) => void;
  updateWaterLevels: () => void;
  getWaterPenalty: (plotId: string) => number;
  toggleLight: (plotId: string) => void;
  getLightPenalty: (plotId: string) => number;
  prunePlot: (plotId: string) => { success: boolean; bonus: number } | null;
  calculateHarvestResult: (plotId: string) => HarvestResult | null;
  resetFarm: () => void;
}

// Pruning configuration
// Prune 1: 70% success = +15%, fail = -10%
// Prune 2: 50% success = +25% total, fail = -15%
// Prune 3: 30% success = +45% total, fail = -20%
export const PRUNE_CONFIG = [
  { successRate: 0.70, successBonus: 15, failPenalty: -10 },
  { successRate: 0.50, successBonus: 25, failPenalty: -15 },
  { successRate: 0.30, successBonus: 45, failPenalty: -20 },
];

// Water decreases 50% every 2 hours = 50/7200000 per ms (used internally, farming.tsx uses the exported rates)
const WATER_DECAY_RATE = 50 / (2 * 60 * 60 * 1000); // 50% per 2 hours
// Below 0% water, lose 10% yield per hour (1h virtuelle = 1 jour réel)
const YIELD_PENALTY_RATE = 10 / (60 * 60 * 1000); // 10% per hour
// Light cycle: uses NORMAL_LIGHT_CYCLE_MS or ADMIN_LIGHT_CYCLE_MS from above
// Keeping LIGHT_CYCLE_MIN_MS for backwards compatibility
export const LIGHT_CYCLE_MIN_MS = NORMAL_LIGHT_CYCLE_MS;
// Penalty: 5% quality loss per hour virtuelle of violation
const LIGHT_PENALTY_RATE = 5 / (60 * 60 * 1000); // 5% per hour

export const useFarmingStore = create<FarmingStore>()(
  persist(
    (set, get) => ({
      coins: 50,
      plots: createInitialPlots(),
      cropLevels: createInitialCropLevels(),
      harvestedCrops: {
        outdoor: 0,
        greenhouse: 0,
        indoor: 0,
      },
      totalHarvests: 0,

      plantCrop: (plotId: string, cropType: CropType, isAdmin?: boolean) =>
        set((state) => {
          const cropConfig = CROP_CONFIG[cropType];

          // Check if player has enough coins
          if (state.coins < cropConfig.cost) return state;

          const plot = state.plots.find((p) => p.id === plotId);
          if (!plot || plot.state !== 'empty' || !plot.unlocked) return state;

          // Use admin or normal growth time
          const growthDuration = getGrowthTime(cropType, isAdmin ?? false);

          return {
            coins: state.coins - cropConfig.cost,
            plots: state.plots.map((p) =>
              p.id === plotId
                ? {
                    ...p,
                    state: 'planted' as PlotState,
                    cropType,
                    plantedAt: Date.now(),
                    growthDuration,
                    waterLevel: 100,
                    lastWaterUpdate: Date.now(),
                    lightOn: true,
                    lightChangedAt: Date.now(),
                    lightPenalty: 0,
                    pruneCount: 0,
                    pruneBonus: 0,
                    wateringScore: 100,
                    totalWaterings: 0,
                    timesWaterCritical: 0,
                  }
                : p
            ),
          };
        }),

      harvestCrop: (plotId: string): HarvestResult | null => {
        const state = get();
        const plot = state.plots.find((p) => p.id === plotId);
        if (!plot || plot.state !== 'ready' || !plot.cropType) return null;

        const cropType = plot.cropType;
        const cropConfig = CROP_CONFIG[cropType];
        const currentCropLevel = state.cropLevels[cropType];

        // Base grams based on crop type and level
        const baseGrams = cropConfig.baseReward * LEVEL_MULTIPLIERS[Math.min(currentCropLevel.level - 1, 4)];

        // Calculate water multiplier based on watering score
        // Perfect (score >= 90): x2, Good (score >= 70): x1.5, Medium (score >= 50): x1.2, Poor: x1
        let waterMultiplier = 1;
        let waterQuality: 'parfait' | 'bon' | 'moyen' | 'faible' = 'faible';
        if (plot.wateringScore >= 90) {
          waterMultiplier = 2;
          waterQuality = 'parfait';
        } else if (plot.wateringScore >= 70) {
          waterMultiplier = 1.5;
          waterQuality = 'bon';
        } else if (plot.wateringScore >= 50) {
          waterMultiplier = 1.2;
          waterQuality = 'moyen';
        }

        // Calculate light multiplier (only for indoor)
        // No penalty = x1.5, with penalty = reduced based on penalty amount
        let lightMultiplier = 1;
        if (cropType === 'indoor') {
          if (plot.lightPenalty === 0) {
            lightMultiplier = 1.5;
          } else {
            // Reduce multiplier based on penalty (max 50% penalty = x0.75)
            lightMultiplier = Math.max(0.75, 1.5 - (plot.lightPenalty / 100));
          }
        } else {
          // Non-indoor crops get a flat 1.2 bonus for natural light
          lightMultiplier = 1.2;
        }

        // Prune bonus (can be negative)
        const pruneBonus = plot.pruneBonus;
        const pruneBonusMultiplier = 1 + (pruneBonus / 100);

        // Calculate final grams
        const finalGrams = Math.round(baseGrams * waterMultiplier * lightMultiplier * pruneBonusMultiplier);

        // Calculate XP (proportional to grams harvested)
        const xpGained = Math.round(cropConfig.baseXp * (finalGrams / baseGrams));

        // Update state
        const newXp = currentCropLevel.experience + xpGained;
        let newLevel = currentCropLevel.level;
        let remainingXp = newXp;
        let xpToNext = currentCropLevel.experienceToNextLevel;

        // Level up if enough XP (max level 5)
        while (newLevel < 5 && remainingXp >= xpToNext) {
          remainingXp -= xpToNext;
          newLevel++;
          xpToNext = calculateCropXpToNextLevel(newLevel);
        }

        // If at max level, no more XP needed
        if (newLevel >= 5) {
          remainingXp = 0;
          xpToNext = 0;
        }

        // Convert grams to coins (1 gram = 1 coin)
        const coinsEarned = finalGrams;

        set((state) => ({
          plots: state.plots.map((p) =>
            p.id === plotId
              ? {
                  ...p,
                  state: 'empty' as PlotState,
                  cropType: null,
                  plantedAt: null,
                  growthDuration: 0,
                  waterLevel: 100,
                  lastWaterUpdate: null,
                  lightPenalty: 0,
                  pruneCount: 0,
                  pruneBonus: 0,
                  wateringScore: 100,
                  totalWaterings: 0,
                  timesWaterCritical: 0,
                }
              : p
          ),
          coins: state.coins + coinsEarned,
          cropLevels: {
            ...state.cropLevels,
            [cropType]: {
              level: newLevel,
              experience: remainingXp,
              experienceToNextLevel: xpToNext,
            },
          },
          harvestedCrops: {
            ...state.harvestedCrops,
            [cropType]: state.harvestedCrops[cropType] + 1,
          },
          totalHarvests: state.totalHarvests + 1,
        }));

        return {
          grams: finalGrams,
          xpGained,
          waterMultiplier,
          lightMultiplier,
          pruneBonus,
          baseGrams: Math.round(baseGrams),
          quality: waterQuality,
        };
      },

      unlockPlot: (plotId: string) => {
        const state = get();
        const plotIndex = state.plots.findIndex((p) => p.id === plotId);
        const cost = get().getPlotUnlockCost(plotIndex);

        if (state.coins < cost) return false;

        set((state) => ({
          coins: state.coins - cost,
          plots: state.plots.map((plot) =>
            plot.id === plotId ? { ...plot, unlocked: true } : plot
          ),
        }));
        return true;
      },

      addCoins: (amount: number) =>
        set((state) => ({
          coins: state.coins + amount,
        })),

      updatePlotGrowth: (plotId: string) =>
        set((state) => {
          const plot = state.plots.find((p) => p.id === plotId);
          if (!plot || !plot.plantedAt || plot.state === 'ready' || plot.state === 'empty') {
            return state;
          }

          const elapsed = Date.now() - plot.plantedAt;
          const isReady = elapsed >= plot.growthDuration;

          if (isReady) {
            return {
              plots: state.plots.map((p) =>
                p.id === plotId ? { ...p, state: 'ready' as PlotState } : p
              ),
            };
          }

          // Update to growing state if not already
          if (plot.state === 'planted' && elapsed > 0) {
            return {
              plots: state.plots.map((p) =>
                p.id === plotId ? { ...p, state: 'growing' as PlotState } : p
              ),
            };
          }

          return state;
        }),

      getPlotUnlockCost: (plotIndex: number) => {
        // Exponential cost for unlocking plots
        return Math.floor(50 * Math.pow(1.8, plotIndex - 4));
      },

      waterPlot: (plotId: string) =>
        set((state) => ({
          plots: state.plots.map((p) => {
            if (p.id !== plotId) return p;

            // Calculate watering score penalty if water was low
            let newWateringScore = p.wateringScore;
            if (p.waterLevel < 30) {
              // Penalty for letting water go critical
              newWateringScore = Math.max(0, p.wateringScore - 5);
            } else if (p.waterLevel < 50) {
              // Small penalty for letting water get low
              newWateringScore = Math.max(0, p.wateringScore - 2);
            }

            return {
              ...p,
              waterLevel: 100,
              lastWaterUpdate: Date.now(),
              wateringScore: newWateringScore,
              totalWaterings: p.totalWaterings + 1,
              timesWaterCritical: p.waterLevel < 30 ? p.timesWaterCritical + 1 : p.timesWaterCritical,
            };
          }),
        })),

      updateWaterLevels: () =>
        set((state) => {
          const now = Date.now();
          return {
            plots: state.plots.map((p) => {
              // Only update water for planted/growing plots
              if (p.state === 'empty' || p.state === 'ready' || !p.lastWaterUpdate) {
                return p;
              }

              const elapsed = now - p.lastWaterUpdate;
              const waterLost = elapsed * WATER_DECAY_RATE;
              const newWaterLevel = Math.max(0, p.waterLevel - waterLost);

              return {
                ...p,
                waterLevel: newWaterLevel,
                lastWaterUpdate: now,
              };
            }),
          };
        }),

      getWaterPenalty: (plotId: string) => {
        const state = get();
        const plot = state.plots.find((p) => p.id === plotId);
        if (!plot || plot.waterLevel > 0) return 0;

        // Calculate how long water has been at 0%
        // For simplicity, we return a penalty based on current state
        // Max penalty is 50% (5 hours at 0% water)
        const timeSinceZero = plot.lastWaterUpdate ? Date.now() - plot.lastWaterUpdate : 0;
        const penalty = Math.min(50, timeSinceZero * YIELD_PENALTY_RATE);
        return Math.floor(penalty);
      },

      toggleLight: (plotId: string) =>
        set((state) => {
          const plot = state.plots.find((p) => p.id === plotId);
          if (!plot || plot.state === 'empty' || plot.state === 'ready') return state;

          const now = Date.now();
          let newPenalty = plot.lightPenalty;

          // Check if minimum time has passed since last toggle
          if (plot.lightChangedAt) {
            const elapsed = now - plot.lightChangedAt;
            if (elapsed < LIGHT_CYCLE_MIN_MS) {
              // Add penalty for early toggle: 5% per 5 seconds of remaining time
              const remainingMs = LIGHT_CYCLE_MIN_MS - elapsed;
              const penaltyToAdd = (remainingMs / 1000) * (LIGHT_PENALTY_RATE * 1000);
              newPenalty = Math.min(100, plot.lightPenalty + penaltyToAdd);
            }
          }

          return {
            plots: state.plots.map((p) =>
              p.id === plotId
                ? {
                    ...p,
                    lightOn: !p.lightOn,
                    lightChangedAt: now,
                    lightPenalty: newPenalty,
                  }
                : p
            ),
          };
        }),

      getLightPenalty: (plotId: string) => {
        const state = get();
        const plot = state.plots.find((p) => p.id === plotId);
        if (!plot) return 0;
        return Math.floor(plot.lightPenalty);
      },

      prunePlot: (plotId: string) => {
        const state = get();
        const plot = state.plots.find((p) => p.id === plotId);

        // Can only prune during growth phase and max 3 times
        // Check both 'planted' and 'growing' states as both represent active growth
        if (!plot || (plot.state !== 'growing' && plot.state !== 'planted') || plot.pruneCount >= 3) return null;

        // Check if in croissance phase (33-66% progress)
        if (plot.plantedAt && plot.growthDuration) {
          const elapsed = Date.now() - plot.plantedAt;
          const progress = elapsed / plot.growthDuration;
          if (progress < 0.33 || progress >= 0.66) return null; // Not in croissance phase
        }

        const pruneIndex = plot.pruneCount;
        const config = PRUNE_CONFIG[pruneIndex];
        const roll = Math.random();
        const success = roll < config.successRate;
        const bonus = success ? config.successBonus : config.failPenalty;

        set((state) => ({
          plots: state.plots.map((p) =>
            p.id === plotId
              ? {
                  ...p,
                  pruneCount: p.pruneCount + 1,
                  pruneBonus: success ? config.successBonus : p.pruneBonus + config.failPenalty,
                }
              : p
          ),
        }));

        return { success, bonus };
      },

      calculateHarvestResult: (plotId: string): HarvestResult | null => {
        const state = get();
        const plot = state.plots.find((p) => p.id === plotId);
        if (!plot || plot.state !== 'ready' || !plot.cropType) return null;

        const cropType = plot.cropType;
        const cropConfig = CROP_CONFIG[cropType];
        const currentCropLevel = state.cropLevels[cropType];

        // Base grams based on crop type and level
        const baseGrams = cropConfig.baseReward * LEVEL_MULTIPLIERS[Math.min(currentCropLevel.level - 1, 4)];

        // Calculate water multiplier
        let waterMultiplier = 1;
        let waterQuality: 'parfait' | 'bon' | 'moyen' | 'faible' = 'faible';
        if (plot.wateringScore >= 90) {
          waterMultiplier = 2;
          waterQuality = 'parfait';
        } else if (plot.wateringScore >= 70) {
          waterMultiplier = 1.5;
          waterQuality = 'bon';
        } else if (plot.wateringScore >= 50) {
          waterMultiplier = 1.2;
          waterQuality = 'moyen';
        }

        // Calculate light multiplier
        let lightMultiplier = 1;
        if (cropType === 'indoor') {
          lightMultiplier = plot.lightPenalty === 0 ? 1.5 : Math.max(0.75, 1.5 - (plot.lightPenalty / 100));
        } else {
          lightMultiplier = 1.2;
        }

        const pruneBonusMultiplier = 1 + (plot.pruneBonus / 100);
        const finalGrams = Math.round(baseGrams * waterMultiplier * lightMultiplier * pruneBonusMultiplier);
        const xpGained = Math.round(cropConfig.baseXp * (finalGrams / baseGrams));

        return {
          grams: finalGrams,
          xpGained,
          waterMultiplier,
          lightMultiplier,
          pruneBonus: plot.pruneBonus,
          baseGrams: Math.round(baseGrams),
          quality: waterQuality,
        };
      },

      resetFarm: () =>
        set({
          coins: 50,
          plots: createInitialPlots(),
          cropLevels: createInitialCropLevels(),
          harvestedCrops: {
            outdoor: 0,
            greenhouse: 0,
            indoor: 0,
          },
          totalHarvests: 0,
        }),
    }),
    {
      name: 'cbd-farming-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
