import React from "react";
import ReactDOM from "react-dom/client";
import { HeroUIProvider } from "@heroui/react";
import App from "./App";
import "./index.css";

document.documentElement.classList.add("dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HeroUIProvider>
      <App />
    </HeroUIProvider>
  </React.StrictMode>,
);
