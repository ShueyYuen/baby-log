import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { BabyProvider } from './contexts/BabyContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { setupServiceWorkerMessageHandler } from './lib/push';
import './index.css';

setupServiceWorkerMessageHandler();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <BabyProvider>
            <App />
          </BabyProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
