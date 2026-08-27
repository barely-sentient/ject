export default {
  testEnvironment: "node",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          rootDir: ".",
          module: "commonjs",
          moduleResolution: "node",
          isolatedModules: true,
          esModuleInterop: true,
        },
      },
    ],
  },
};
