/** Jest harness (docs/specs/0009). Unit tests only in v0 — no DB, no network. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: {
    // Tests compile standalone; commonjs here keeps ts-jest independent of the
    // build's node16 settings
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true } },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
};
