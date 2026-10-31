import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<App />);
