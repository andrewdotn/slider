import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["**/*.test.ts", "app.test.tsx"],
          exclude: [
            "**/node_modules/**",
            "**/.claude/**",
            "keyboard-nav.test.tsx",
            "mdx-error.test.tsx",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["keyboard-nav.test.tsx", "mdx-error.test.tsx"],
          exclude: ["**/node_modules/**", "**/.claude/**"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
} as any);
