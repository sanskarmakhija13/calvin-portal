import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import theme from "./theme"; // Our custom theme!

class AppErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'Arial, sans-serif', color: '#222' }}>
          <h2>Calvin could not load this page</h2>
          <p>Refresh the page or return to login. If this continues, restart the local app.</p>
          <details>
            <summary>Technical details</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error?.stack || this.state.error?.message || JSON.stringify(this.state.error, Object.getOwnPropertyNames(this.state.error || {})) || 'Unknown render error'}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </ThemeProvider>
);
