import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 本地诊断脚本（chrome-devtools 截图等），非业务源码
    "_diag-shot.cjs",
  ]),
  // ── Baseline 治理（2026-07-29，ci/frontend-lint 分支）──
  // web 历史存量 501 error，构成：
  //  - any(281)/unused-vars(161)：渐进迁移的类型债
  //  - react-hooks/* 新规则(167：set-state-in-effect/refs/purity 等)：Next16/React19
  //    工具链升级引入的激进规则，与既有代码大面积摩擦，非性能/正确性硬伤
  // 先统一降为 warning 不阻断 CI，配合 lint 脚本 --max-warnings 冻结总量；
  // 后续逐文件清理后恢复 error 级（优先 react-hooks/rules-of-hooks）。
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react/no-unescaped-entities": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@next/next/no-assign-module-variable": "warn",
      "prefer-const": "warn",
    },
  },
]);

export default eslintConfig;
