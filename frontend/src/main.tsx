import { Toast } from "@heroui/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "./index.css";

document.documentElement.classList.add("dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* v3 不需要 HeroUIProvider；Toast 是唯一要挂的出口，placement 对齐旧版右下角 */}
    <Toast.Provider placement="bottom end" />
    <App />
  </React.StrictMode>,
);
