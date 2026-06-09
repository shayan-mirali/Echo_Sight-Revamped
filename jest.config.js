/**
 * Unit tests only — pure logic (classifier, audio features, validation, guards,
 * env). No database or running server required, so these run anywhere (incl. CI
 * without infra). Endpoint/DB behavior is covered by scripts/*-check.mjs against
 * a live instance.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
};
