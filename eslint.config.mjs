import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["tailwind.js"],
  },
  {
    files: ["main.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: globals.browser,
    },
    rules: js.configs.recommended.rules,
  },
];
