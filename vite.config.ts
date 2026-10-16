import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { proxyApi } from "./proxy-api.ts";

// API_* variables have no VITE_ prefix: they stay on the dev server and never
// reach the browser bundle.
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const adresses = [env.API_VPN || "100.64.0.8:8140", env.API_LAN || "192.168.1.31:8140"].map((a) =>
        a.startsWith("http") ? a : `http://${a}`,
    );
    return {
        plugins: [react(), tailwindcss(), proxyApi({ adresses, cle: env.API_KEY ?? "" })],
        server: { port: 5173, host: true },
        preview: { port: 4173, host: true },
    };
});
