// Global Error Overlay for Debugging
window.onerror = function (msg, url, lineNo, columnNo, error) {
  const div = document.createElement('div')
  div.style.position = 'fixed'
  div.style.top = '0'
  div.style.left = '0'
  div.style.width = '100vw'
  div.style.height = '100vh'
  div.style.backgroundColor = 'rgba(255, 0, 0, 0.9)'
  div.style.color = 'white'
  div.style.zIndex = '99999'
  div.style.padding = '20px'
  div.style.fontFamily = 'monospace'
  div.style.whiteSpace = 'pre-wrap'
  div.style.overflow = 'auto'
  div.innerHTML = `<h2>🔥 FATAL ERROR 🔥</h2><p>${msg}</p><pre>${error && error.stack}</pre>`
  document.body.appendChild(div)
  return false
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
