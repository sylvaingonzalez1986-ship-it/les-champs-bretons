/** @type {import('jest').Config} */
module.exports = {
  preset: 'react-native',
  testMatch: ['**/__tests__/**/*.(spec|test).(ts|tsx|js|jsx)'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|@react-native-community|@react-native-async-storage|expo|expo-.*|@expo|@unimodules|nativewind|react-native-svg|react-native-reanimated)/)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
