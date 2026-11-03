// Date tests depend on the local timezone (meeting-dates.test.ts exercises the
// local-vs-UTC day split and a DST change). Pin one here: setting process.env.TZ
// inside a test file doesn't work, because Jest gives each file its own copy of
// process.env, so CI (UTC) and a laptop (local time) would otherwise disagree.
process.env.TZ = 'America/New_York';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.main.json',
    }],
  },
};
