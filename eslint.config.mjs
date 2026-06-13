// ---------------------------------------------------------------------------
// ESLint flat config for JARVIS.
// ---------------------------------------------------------------------------

import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "ui/dist/**", "node_modules/**", "data/**", "graphify-out/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Phase 0 scaffold intentionally has some unused parameters in IPC
      // handler signatures (e.g. `_event`) and stubs; tsconfig already
      // disables noUnusedLocals/Parameters for the same reason.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
