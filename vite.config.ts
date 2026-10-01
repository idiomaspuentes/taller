import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const usfmAst = path.resolve(root, "../usfm-ast/packages");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      "@usfm-tools/parser": path.resolve(usfmAst, "usfm-parser/src/index.ts"),
      "@usfm-ast/alignment-box-model": path.resolve(usfmAst, "usfm-editor-app/src/hooks/useAlignmentBoxModel.ts"),
      "@usfm-tools/editor-core": path.resolve(usfmAst, "usfm-editor-core/src/index.ts"),
      "@usfm-tools/adapters": path.resolve(usfmAst, "usfm-adapters/src/index.ts"),
      "@usfm-tools/formatter": path.resolve(usfmAst, "usfm-formatter/src/index.ts"),
      "@usfm-tools/checking": path.resolve(usfmAst, "usfm-editor-checking/src/index.ts"),
      "@usfm-tools/types": path.resolve(usfmAst, "shared-types/src/index.ts"),
      "@usfm-tools/usj-core": path.resolve(usfmAst, "usfm-usj-core/src/index.ts"),
      "@usfm-tools/help-markdown": path.resolve(usfmAst, "help-markdown/src/index.ts"),
      "@usfm-tools/usfm-readonly-react/styles.css": path.resolve(
        usfmAst,
        "usfm-readonly-react/src/default.css",
      ),
      "@usfm-tools/usfm-readonly-react": path.resolve(
        usfmAst,
        "usfm-readonly-react/src/index.ts",
      ),
    },
  },
  server: {
    port: 5175,
    strictPort: false,
  },
});
