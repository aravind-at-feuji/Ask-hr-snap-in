module.exports = {
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 20
    }
  },
  coverageReporters: ['text'],
  preset: 'ts-jest',
  testEnvironment: 'node'
};
