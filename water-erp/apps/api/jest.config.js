module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: { allowJs: true } }],
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@water-erp/config$": "<rootDir>/../../../packages/config/src/index.ts",
  },
  // 转译 ESM 依赖：jest 默认忽略整个 node_modules，ESM-only 包(如 htmlparser2 全家)经
  // sanitize-html 引入时以原始 ESM 加载会报 "Cannot use import statement outside a module"。
  // pnpm 下包真实路径含两个 node_modules 段（.../node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/），
  // 单正则的可选前缀会回溯误判，故拆两条互补模式：
  //   A 命中「.pnpm/<非allowlist包>@」→ 忽略；  B 命中「node_modules/<非allowlist且非.pnpm>/」→ 忽略。
  // allowlist 包(htmlparser2 全家)两条都不命中 → 交给 ts-jest 转译。
  // allowJs(仅 jest 范围) 让 ts-jest 真正编译这些 ESM .js 为 CJS，不污染 build 用 tsconfig。
  transformIgnorePatterns: [
    "node_modules/\\.pnpm/(?!(htmlparser2|entities|domelementtype|domhandler|domutils|dom-serializer)@)",
    "node_modules/(?!(htmlparser2|entities|domelementtype|domhandler|domutils|dom-serializer|\\.pnpm)/)",
  ],
};
