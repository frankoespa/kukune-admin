import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pluginDatos from "./vite-plugin-datos.js";
import pluginML from "./vite-plugin-ml.js";
import pluginTN from "./vite-plugin-tn.js";

export default defineConfig({
  plugins: [react(), pluginDatos(), pluginML(), pluginTN()],
});
