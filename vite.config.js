import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

function appRoute() {
  const redirect = (req, res, next) => {
    if (req.url === "/") {
      res.writeHead(302, { Location: "/Grade%20Match.html" });
      res.end();
      return;
    }
    next();
  };
  return {
    name: "grade-match-app-route",
    configureServer(server) {
      server.middlewares.use(redirect);
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect);
    },
  };
}

export default defineConfig({
  plugins: [appRoute(), viteSingleFile({ outputFileName: "Grade Match.html" })],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    rollupOptions: {
      input: "Grade Match.html",
    },
  },
  optimizeDeps: {
    exclude: ["libraw-wasm"],
  },
});
