import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const rootEl = document.getElementById('root');
if (rootEl == null) {
  throw new Error('未找到挂载点 #root');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
