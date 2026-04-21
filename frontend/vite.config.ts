import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

async function getOptionalComponentTagger(mode: string) {
  if (mode !== "development") {
    return [];
  }

  try {
    const mod = await import("lovable-tagger");
    return [mod.componentTagger()];
  } catch {
    return [];
  }
}

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), ...(await getOptionalComponentTagger(mode))],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
