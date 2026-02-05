import { useEffect, useRef, useState } from "react";
import { createApi, type AccessInfo } from "../api";

export default function AccessScreen({
  api,
  onReveal,
  t,
}: {
  api: ReturnType<typeof createApi>;
  onReveal: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const clickRef = useRef({ count: 0, last: 0 });

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError(false);
      try {
        const data = await api.getAccessInfo();
        if (active) {
          setInfo(data);
        }
      } catch {
        if (active) {
          setError(true);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [api]);

  const keyLine = (() => {
    if (loading) {
      return t("access.key.loading");
    }
    if (error || !info) {
      return t("access.key.error");
    }
    if (info.enabled) {
      return t("access.key.enabled", { key: info.api_key || "<empty>" });
    }
    return t("access.key.disabled");
  })();

  function handleTitleTap() {
    const now = Date.now();
    const last = clickRef.current.last;
    if (now - last > 700) {
      clickRef.current.count = 0;
    }
    clickRef.current.last = now;
    clickRef.current.count += 1;
    if (clickRef.current.count >= 10) {
      clickRef.current.count = 0;
      onReveal();
    }
  }

  const paragraphs = [
    "access.p1",
    "access.p2",
    "access.p3",
    "access.p4",
    "access.p5",
    "access.p6",
  ]
    .map((key) => ({ key, text: t(key) }))
    .filter(({ key, text }) => text.trim().length > 0 && text !== key);

  const footerText = t("access.footer");

  return (
    <div className="access-root">
      <div className="access-shell animate-[fadeIn_0.6s_ease-out]">
        <header className="access-header">
          <div className="access-badge">{t("access.badge")}</div>
          <div>
            <h1 className="access-title" onClick={handleTitleTap}>
              {t("access.title")}
            </h1>
            <p className="access-subtitle">{t("access.subtitle")}</p>
          </div>
        </header>

        <section className="access-body">
          <p className="access-lead">{t("access.lead")}</p>
          {paragraphs.map((item) => (
            <p key={item.key} className="access-paragraph">
              {item.text}
            </p>
          ))}

          <div className="access-panel">
            <div className="access-panel-title">{t("access.key.title")}</div>
            <div className="access-panel-content">
              <span className="access-mono">{keyLine}</span>
            </div>
          </div>
        </section>

        {footerText.trim().length > 0 ? (
          <footer className="access-footer">
            <p>{footerText}</p>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
