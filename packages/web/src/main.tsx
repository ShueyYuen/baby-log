import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { BabyProvider } from './contexts/BabyContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BabyProvider>
          <App />
        </BabyProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
