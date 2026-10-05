import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const reactHooksPlugin = nextVitals[0].plugins["react-hooks"];
const typeScriptPlugin = nextTypeScript[0].plugins["@typescript-eslint"];

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["**/*.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}"],
    plugins: {
      "@typescript-eslint": typeScriptPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "coverage/**",
    "public/vendor/**",
    "standalone/**",
    ".standalone/**",
    "release/**",
    "releases/**",
    "artifacts/**",
    "artifact/**",
    "**/machinery-crm-v108-step1-prebuilt-standalone-linux-x64/**",
    "mysql57-phase4/**",
    ".mysql57/**",
    "**/data-phase4/**",
    "deploy/identity-acceptance/.build/**",
  ]),
]);
