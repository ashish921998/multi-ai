import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // During local dev, forward Edge Function calls to the local Supabase
      // runtime started with `supabase functions serve`.
      "/functions": {
        target: "http://localhost:54321",
        changeOrigin: true,
        rewrite: (p) => p,
      },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
