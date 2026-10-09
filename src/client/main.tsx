import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { EditorPreferencesProvider } from "./contexts/EditorPreferences";
import { PluginConnectPage } from './components/PluginConnectPage';

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <AuthProvider>
    {new URLSearchParams(window.location.search).get('screen') === 'plugin-connect'
      ? <PluginConnectPage /> : <EditorPreferencesProvider><App /></EditorPreferencesProvider>}
  </AuthProvider>,
);
