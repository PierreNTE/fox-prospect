"use client";

// Intégration Fluent UI v9 dans Next.js App Router (SSR-safe).
// - createDOMRenderer + RendererProvider : moteur de styles Griffel.
// - useServerInsertedHTML : injecte les styles côté serveur (pas de FOUC).
// - FluentProvider : applique le thème de marque (clair/sombre selon le système).

import * as React from "react";
import { useServerInsertedHTML } from "next/navigation";
import {
  createDOMRenderer,
  RendererProvider,
  SSRProvider,
  renderToStyleElements,
  FluentProvider,
} from "@fluentui/react-components";
import { foxLightTheme, foxDarkTheme } from "@/lib/fluent-theme";

export default function FluentRoot({ children }) {
  const [renderer] = React.useState(() => createDOMRenderer());
  const [dark, setDark] = React.useState(false);

  useServerInsertedHTML(() => renderToStyleElements(renderer));

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const onChange = (e) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <RendererProvider renderer={renderer}>
      <SSRProvider>
        <FluentProvider
          theme={dark ? foxDarkTheme : foxLightTheme}
          style={{ background: "transparent", minHeight: "100vh" }}
        >
          {children}
        </FluentProvider>
      </SSRProvider>
    </RendererProvider>
  );
}
