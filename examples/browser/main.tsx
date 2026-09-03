import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DialogueExample } from "../../src/react/DialogueExample.js";
import { StoryletsDemo } from "./StoryletsDemo.js";
// Import CSS for dialogue system
import "../../src/react/dialogue.css";

const TABS = [
  { id: "dialogue", label: "Dialogue", blurb: "The visual-novel dialogue view on the pull-based runtime." },
  { id: "storylets", label: "Storylets", blurb: "A node-group storylet demo with switchable saliency strategies." },
] as const;

type TabId = (typeof TABS)[number]["id"];

function DemoShell() {
  const [tab, setTab] = useState<TabId>("dialogue");
  const active = TABS.find((t) => t.id === tab);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#1a1a2e",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ maxWidth: "1000px", width: "100%" }}>
        <nav role="tablist" aria-label="Demos" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              style={{
                backgroundColor: tab === t.id ? "#4f7cff" : "#2a2d3e",
                color: "#ffffff",
                border: "1px solid #43475c",
                borderRadius: 6,
                padding: "8px 16px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <p style={{ color: "#9aa0b5", fontSize: 13, margin: "0 0 16px" }}>{active?.blurb}</p>
        {tab === "dialogue" ? <DialogueExample /> : <StoryletsDemo />}
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element not found");
}

const root = createRoot(rootEl);
root.render(<DemoShell />);
