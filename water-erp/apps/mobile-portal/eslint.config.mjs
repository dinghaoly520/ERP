import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),
  // react-hooks 新规则与 web 同款摩擦（2026-07-29 web 基线治理先例）：
  // set-state-in-effect 对「effect 内先置 loading 再异步取数」的惯用写法误报，
  // 非性能/正确性硬伤，降为 warning（与 apps/web 口径一致）
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
