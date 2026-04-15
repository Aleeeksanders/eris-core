// ============================================================
// Eris — Interfaz Ink (Rich Terminal UI)
// ============================================================

import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { QueryEngine } from "./QueryEngine.js";

export async function startInkUI(queryEngine: QueryEngine): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(App, { queryEngine })
  );

  await waitUntilExit();
}
