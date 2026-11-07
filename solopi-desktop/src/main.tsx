import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const isResizeObserverNoise = (message: unknown) => (
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i.test(String(message || ""))
);

window.addEventListener("error", (event) => {
  if (isResizeObserverNoise(event.message)) {
    event.stopImmediatePropagation();
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (isResizeObserverNoise(event.reason?.message || event.reason)) {
    event.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
