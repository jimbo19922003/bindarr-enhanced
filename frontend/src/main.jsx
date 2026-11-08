import React from 'react'
import ReactDOM from 'react-dom/client'
import './apiBase.js'
import './nativeInit.js'
import App from './App.jsx'
import { I18nProvider } from './utils/i18n.jsx'
import CurrencyDisplayRefresh from './components/CurrencyDisplayRefresh.jsx'
import './index.css'

if (import.meta.env.VITE_DEMO) {
  await import('./demo/install.js')
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <CurrencyDisplayRefresh><App /></CurrencyDisplayRefresh>
    </I18nProvider>
  </React.StrictMode>,
)
