export default {
  projects: [
    {
      displayName: "cumulocity-cypress",
      preset: "ts-jest/presets/default-esm",
      extensionsToTreatAsEsm: [".ts"],
      roots: ["<rootDir>/src"],
      transform: {
        "^.+\\.tsx?$": [
          "ts-jest",
          {
            tsconfig: "<rootDir>/tsconfig.spec.json",
            useESM: true,
          },
        ],
        "^.+\\.jsx?$": "@swc/jest",
      },
      transformIgnorePatterns: [
        "node_modules/(?!(@apidevtools|@jsdevtools)/)",
      ],
      testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
      moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
      moduleNameMapper: {
        "^cumulocity-cypress/(.*)$": "<rootDir>/src/$1",
        "^(\\.{1,2}/.*)\\.js$": "$1",
      },
    },
    {
      displayName: "c8y-cygen",
      preset: "ts-jest/presets/default-esm",
      extensionsToTreatAsEsm: [".ts"],
      rootDir: "packages/c8y-cygen",
      roots: ["<rootDir>/src"],
      transform: {
        "^.+\\.tsx?$": [
          "ts-jest",
          {
            tsconfig: "<rootDir>/tsconfig.spec.json",
            useESM: true,
          },
        ],
      },
      testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
      moduleFileExtensions: ["ts", "js", "json", "node"],
      moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
    },
  ],
};
