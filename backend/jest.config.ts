import type { Config } from 'jest';

const config: Config = {
  // Bukan 'node' bawaan: modul native ONNX menolak typed array dari realm Jest.
  // Lihat tests/onnx-environment.js.
  testEnvironment: '<rootDir>/tests/onnx-environment.js',
  roots: ['<rootDir>/tests'],
  // Dimuat sebelum modul apa pun, supaya src/config/env.ts membaca .env.test
  // dan bukan .env milik development.
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  globalSetup: '<rootDir>/tests/global-setup.ts',
  globalTeardown: '<rootDir>/tests/global-teardown.ts',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  // Semua test berbagi satu database dan saling menghapus data,
  // jadi tidak boleh jalan paralel.
  maxWorkers: 1,
  testTimeout: 30000,
};

export default config;
