import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  plugins: [tsconfigPaths(), tailwindcss(), tanstackStart(), react()],
  server: {
    host: "0.0.0.0",
    port: 8082,
  },
});
