import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import axios from 'axios';
import { getAdminToken } from './lib/adminAuth';

axios.defaults.baseURL = import.meta.env.VITE_API_BASE_URL || '';
axios.interceptors.request.use((config) => {
  const token = getAdminToken();
  const url = typeof config.url === 'string' ? config.url : '';
  if (token && url.includes('/api/')) {
    config.headers = config.headers || {};
    if (!config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
