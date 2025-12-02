import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // allow `any` types
      "@typescript-eslint/no-explicit-any": "off",
      // disable empty-interface warnings
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // disable unused vars check (if desired)
       "no-unused-vars": "off",
       "no-constant-condition": "off",
      // disable hook rules if you really want (not recommended)
      // "react-hooks/rules-of-hooks": "off",
    },
  },
];

export default eslintConfig;
