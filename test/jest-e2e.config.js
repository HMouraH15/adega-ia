/** Testes e2e: sobem a aplicação inteira contra um PostgreSQL real (schema "e2e"). */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/global-setup.js',
  testTimeout: 60_000,
};
