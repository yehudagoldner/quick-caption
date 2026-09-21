import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const devAuth = loadEnv(mode, process.cwd(), "DEV_AUTH");
  const devAuthBypass = command === "serve" && mode === "development" && devAuth.DEV_AUTH_BYPASS === "1";

  return {
    plugins: [react()],
    define: {
      __DEV_AUTH_BYPASS__: JSON.stringify(devAuthBypass),
      __DEV_AUTH_UID__: JSON.stringify(devAuth.DEV_AUTH_UID || "local-dev-user"),
    },
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
        "/health": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
        "/socket.io": {
          target: "http://localhost:3000",
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
