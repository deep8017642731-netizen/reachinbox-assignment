/**
 * Browser entry point.
 *
 * `StrictMode` is enabled on purpose. In development it double-invokes effects and
 * renders, which surfaces missing cleanup functions and duplicate network calls
 * early. If a component misbehaves under StrictMode it would also misbehave in
 * production after a re-render — better to find that while developing.
 *
 * The `!` on getElementById is safe: index.html always provides #root, and if it
 * did not, failing loudly here is the correct outcome.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
