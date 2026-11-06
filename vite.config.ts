import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";
import path from "node:path";
import fs from "node:fs";

function getEnvGeminiKey(): string {
  try {
    for (const f of [".env", "src/.env"]) {
      const full = path.resolve(__dirname, f);
      if (fs.existsSync(full)) {
        const content = fs.readFileSync(full, "utf-8");
        const match = content.match(/(?:API_KEY|GEMINI_API_KEY)\s*=\s*([^\r\n]+)/);
        if (match?.[1]) {
          return match[1].trim().replace(/^["']|["']$/g, "");
        }
      }
    }
  } catch {
    // ignore
  }
  return "";
}

function getEnvGroqKey(): string {
  try {
    for (const f of [".env", "src/.env"]) {
      const full = path.resolve(__dirname, f);
      if (fs.existsSync(full)) {
        const content = fs.readFileSync(full, "utf-8");
        const match = content.match(/(?:GROQ_API_KEY|GROQ_KEY)\s*=\s*([^\r\n]+)/);
        if (match?.[1]) {
          return match[1].trim().replace(/^["']|["']$/g, "");
        }
      }
    }
  } catch {
    // ignore
  }
  return "";
}

export default defineConfig({
  define: {
    __ENV_GEMINI_KEY__: JSON.stringify(getEnvGeminiKey()),
    __ENV_GROQ_KEY__: JSON.stringify(getEnvGroqKey()),
  },
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    cors: {
      origin: [/chrome-extension:\/\//],
    },
  },
});
