import { useEffect, useMemo, useState } from "react";
import Editor, { OnChange, OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { configureMonacoYaml } from "monaco-yaml";

type YamlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onValidate?: (markers: editor.IMarkerData[]) => void;
  onMount?: OnMount;
  schema: Record<string, unknown>;
  path: string;
  readOnly?: boolean;
  height?: string | number;
};

export default function YamlEditor({
  value,
  onChange,
  onValidate,
  onMount,
  schema,
  path,
  readOnly = false,
  height = "58vh",
}: YamlEditorProps) {
  const [ready, setReady] = useState(false);

  const handleChange: OnChange = (next) => {
    onChange(next ?? "");
  };

  const beforeMount = useMemo(
    () => (monaco: typeof import("monaco-editor")) => {
      configureMonacoYaml(monaco, {
        enableSchemaRequest: false,
        validate: true,
        hover: true,
        completion: true,
        format: true,
        schemas: [
          {
            uri: "inmemory://model.schema.json",
            fileMatch: [path],
            schema,
          },
        ],
      });
      monaco.editor.setTheme("mock-llm-dark");
    },
    [path, schema],
  );

  useEffect(() => {
    let cancelled = false;
    import("../monaco")
      .then(() => {
        if (!cancelled) {
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div
        className="flex items-center justify-center text-sm text-slate-400"
        style={{ height }}
      >
        正在加载编辑器...
      </div>
    );
  }

  return (
    <Editor
      language="yaml"
      path={path}
      value={value}
      onChange={handleChange}
      beforeMount={beforeMount}
      onMount={(editor, monaco) => {
        monaco.editor.setTheme("mock-llm-dark");
        editor.updateOptions({
          fontFamily:
            "Consolas, 'Courier New', 'Fira Code', 'JetBrains Mono', monospace",
          fontLigatures: false,
          fontSize: 13,
          lineHeight: 20,
        });
        onMount?.(editor, monaco);
      }}
      onValidate={onValidate}
      theme="mock-llm-dark"
      height={height}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontFamily:
          "Consolas, 'Courier New', 'Fira Code', 'JetBrains Mono', monospace",
        fontLigatures: false,
        fontSize: 13,
        lineHeight: 20,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        renderLineHighlight: "all",
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        quickSuggestions: true,
      }}
    />
  );
}

