import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

function bindVisibleViewport() {
  const root = document.documentElement;
  const sync = () => {
    const vv = window.visualViewport;
    root.style.setProperty("--app-height", `${Math.round(vv?.height ?? window.innerHeight)}px`);
    root.style.setProperty("--app-top", `${Math.round(vv?.offsetTop ?? 0)}px`);
  };
  sync();
  window.visualViewport?.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("scroll", sync);
  window.addEventListener("resize", sync);
}
bindVisibleViewport();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  void navigator.serviceWorker.register(swUrl, {
    scope: import.meta.env.BASE_URL,
  });
}
