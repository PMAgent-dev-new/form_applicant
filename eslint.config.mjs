import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [".next/**", ".claude/worktrees/**", "node_modules/**", "public/**", "gas/**"],
  },
  ...coreWebVitals,
  ...typescript,
];

export default eslintConfig;
