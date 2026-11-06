import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Sahayak side panel root element missing.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
