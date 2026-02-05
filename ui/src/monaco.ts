import * as monaco from "monaco-editor";
import type { Environment } from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import yamlWorker from "monaco-yaml/yaml.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: Environment;
  }
}

window.MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === "yaml") {
      return new yamlWorker();
    }
    return new editorWorker();
  },
};

loader.config({ monaco });

monaco.editor.defineTheme("mock-llm-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#0b1220",
    "editorLineNumber.foreground": "#3b485e",
    "editorLineNumber.activeForeground": "#8aa1c4",
    "editorCursor.foreground": "#7dd3fc",
    "editor.selectionBackground": "#1e3a8a",
    "editor.selectionHighlightBackground": "#1e293b",
    "editor.lineHighlightBackground": "#111827",
  },
});
