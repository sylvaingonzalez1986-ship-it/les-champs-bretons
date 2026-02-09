import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Default options
const DEFAULT_REGIONS = [
  'Auvergne-Rhône-Alpes',
  'Bourgogne-Franche-Comté',
  'Bretagne',
  'Centre-Val de Loire',
  'Corse',
  'Grand Est',
  'Hauts-de-France',
  'Île-de-France',
  'Normandie',
  'Nouvelle-Aquitaine',
  'Occitanie',
  'Pays de la Loire',
  'Provence-Alpes-Côte d\'Azur',
];

const DEFAULT_SOIL_TYPES = [
  'Sol sableux (>70% sable)',
  'Sol sablo-limoneux (40-60% sable, 20-40% limon)',
  'Sol sablo-argileux (40-60% sable, 20-40% argile)',
  'Sol limoneux (>40% limon)',
  'Limon sableux (équilibré sable/limon)',
  'Limon argileux (>40% limon + argile)',
  'Sol argilo-limoneux (30-50% limon, 20-40% argile)',
  'Sol argileux (>40% argile)',
  'Argile limono-sableuse (26% sable, 35% limon, 39% argile)',
  'Sol équilibré/franc (30-40% sable, 30-40% limon, 20-30% argile)',
];

const DEFAULT_CLIMATE_TYPES = [
  'Océanique',
  'Océanique dégradé',
  'Semi-continental',
  'Continental',
  'Méditerranéen',
  'Montagnard',
  'Montagnard tempéré',
];

const DEFAULT_PRODUCT_TYPES = [
  { id: 'fleur', label: 'Fleur', color: '#7d8c5c' },
  { id: 'huile', label: 'Huile', color: '#f1cf6e' },
  { id: 'resine', label: 'Résine', color: '#8b6914' },
  { id: 'infusion', label: 'Infusion', color: '#5a7247' },
];

// Soil type with detailed composition (based on texture triangle)
export interface SoilTypeOption {
  id: string;
  name: string;
  description: string;
  sable: number; // % sand
  limon: number; // % silt
  argile: number; // % clay
}

const DEFAULT_SOIL_TYPE_OPTIONS: SoilTypeOption[] = [
  {
    id: 'sol-sableux',
    name: 'Sol sableux',
    description: 'Sol très drainant, faible rétention d\'eau',
    sable: 75,
    limon: 15,
    argile: 10,
  },
  {
    id: 'sol-sablo-limoneux',
    name: 'Sol sablo-limoneux',
    description: 'Bon drainage avec rétention d\'eau modérée',
    sable: 50,
    limon: 35,
    argile: 15,
  },
  {
    id: 'sol-sablo-argileux',
    name: 'Sol sablo-argileux',
    description: 'Texture grossière avec bonne structure',
    sable: 50,
    limon: 15,
    argile: 35,
  },
  {
    id: 'sol-limoneux',
    name: 'Sol limoneux',
    description: 'Sol fertile, bonne rétention d\'eau et nutriments',
    sable: 25,
    limon: 55,
    argile: 20,
  },
  {
    id: 'limon-sableux',
    name: 'Limon sableux',
    description: 'Équilibre entre drainage et rétention',
    sable: 40,
    limon: 45,
    argile: 15,
  },
  {
    id: 'limon-argileux',
    name: 'Limon argileux',
    description: 'Sol riche, bonne capacité de rétention',
    sable: 15,
    limon: 50,
    argile: 35,
  },
  {
    id: 'sol-argilo-limoneux',
    name: 'Sol argilo-limoneux',
    description: 'Sol lourd mais fertile',
    sable: 25,
    limon: 40,
    argile: 35,
  },
  {
    id: 'sol-argileux',
    name: 'Sol argileux',
    description: 'Sol lourd, excellente rétention d\'eau et nutriments',
    sable: 15,
    limon: 30,
    argile: 55,
  },
  {
    id: 'argile-limono-sableuse',
    name: 'Argile limono-sableuse',
    description: 'Sol équilibré à tendance argileuse',
    sable: 26,
    limon: 35,
    argile: 39,
  },
  {
    id: 'sol-equilibre',
    name: 'Sol équilibré (franc)',
    description: 'Sol idéal pour la plupart des cultures',
    sable: 35,
    limon: 35,
    argile: 30,
  },
];

export interface ProductTypeOption {
  id: string;
  label: string;
  color: string;
}

interface OptionsStore {
  regions: string[];
  soilTypes: string[];
  soilTypeOptions: SoilTypeOption[]; // New: detailed soil types with composition
  climateTypes: string[];
  productTypes: ProductTypeOption[];
  // Regions
  addRegion: (region: string) => void;
  removeRegion: (region: string) => void;
  updateRegion: (oldRegion: string, newRegion: string) => void;
  // Soil types (legacy string-based)
  addSoilType: (soilType: string) => void;
  removeSoilType: (soilType: string) => void;
  updateSoilType: (oldType: string, newType: string) => void;
  // Soil type options (new: with composition)
  addSoilTypeOption: (soilType: SoilTypeOption) => void;
  removeSoilTypeOption: (id: string) => void;
  updateSoilTypeOption: (id: string, updates: Partial<SoilTypeOption>) => void;
  resetSoilTypeOptions: () => void;
  // Climate types
  addClimateType: (climateType: string) => void;
  removeClimateType: (climateType: string) => void;
  updateClimateType: (oldType: string, newType: string) => void;
  // Product types
  addProductType: (productType: ProductTypeOption) => void;
  removeProductType: (id: string) => void;
  updateProductType: (id: string, updates: Partial<ProductTypeOption>) => void;
  // Reset
  resetToDefaults: () => void;
}

export const useOptionsStore = create<OptionsStore>()(
  persist(
    (set) => ({
      regions: DEFAULT_REGIONS,
      soilTypes: DEFAULT_SOIL_TYPES,
      soilTypeOptions: DEFAULT_SOIL_TYPE_OPTIONS,
      climateTypes: DEFAULT_CLIMATE_TYPES,
      productTypes: DEFAULT_PRODUCT_TYPES,

      // Regions
      addRegion: (region: string) =>
        set((state) => ({
          regions: [...state.regions, region].sort(),
        })),
      removeRegion: (region: string) =>
        set((state) => ({
          regions: state.regions.filter((r) => r !== region),
        })),
      updateRegion: (oldRegion: string, newRegion: string) =>
        set((state) => ({
          regions: state.regions.map((r) => (r === oldRegion ? newRegion : r)).sort(),
        })),

      // Soil types (legacy)
      addSoilType: (soilType: string) =>
        set((state) => ({
          soilTypes: [...state.soilTypes, soilType].sort(),
        })),
      removeSoilType: (soilType: string) =>
        set((state) => ({
          soilTypes: state.soilTypes.filter((s) => s !== soilType),
        })),
      updateSoilType: (oldType: string, newType: string) =>
        set((state) => ({
          soilTypes: state.soilTypes.map((s) => (s === oldType ? newType : s)).sort(),
        })),

      // Soil type options (with composition)
      addSoilTypeOption: (soilType: SoilTypeOption) =>
        set((state) => ({
          soilTypeOptions: [...state.soilTypeOptions, soilType],
        })),
      removeSoilTypeOption: (id: string) =>
        set((state) => ({
          soilTypeOptions: state.soilTypeOptions.filter((s) => s.id !== id),
        })),
      updateSoilTypeOption: (id: string, updates: Partial<SoilTypeOption>) =>
        set((state) => ({
          soilTypeOptions: state.soilTypeOptions.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        })),
      resetSoilTypeOptions: () =>
        set({
          soilTypeOptions: DEFAULT_SOIL_TYPE_OPTIONS,
        }),

      // Climate types
      addClimateType: (climateType: string) =>
        set((state) => ({
          climateTypes: [...state.climateTypes, climateType].sort(),
        })),
      removeClimateType: (climateType: string) =>
        set((state) => ({
          climateTypes: state.climateTypes.filter((c) => c !== climateType),
        })),
      updateClimateType: (oldType: string, newType: string) =>
        set((state) => ({
          climateTypes: state.climateTypes.map((c) => (c === oldType ? newType : c)).sort(),
        })),

      // Product types
      addProductType: (productType: ProductTypeOption) =>
        set((state) => ({
          productTypes: [...state.productTypes, productType],
        })),
      removeProductType: (id: string) =>
        set((state) => ({
          productTypes: state.productTypes.filter((p) => p.id !== id),
        })),
      updateProductType: (id: string, updates: Partial<ProductTypeOption>) =>
        set((state) => ({
          productTypes: state.productTypes.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),

      // Reset
      resetToDefaults: () =>
        set({
          regions: DEFAULT_REGIONS,
          soilTypes: DEFAULT_SOIL_TYPES,
          soilTypeOptions: DEFAULT_SOIL_TYPE_OPTIONS,
          climateTypes: DEFAULT_CLIMATE_TYPES,
          productTypes: DEFAULT_PRODUCT_TYPES,
        }),
    }),
    {
      name: 'cbd-options-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
