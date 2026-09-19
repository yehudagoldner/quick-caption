import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { EditorPreferencesProvider } from "./contexts/EditorPreferences";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <AuthProvider>
    <EditorPreferencesProvider><App /></EditorPreferencesProvider>
  </AuthProvider>,
);
