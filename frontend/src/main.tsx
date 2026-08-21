import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiTopologyDataSource } from './topology/apiTopologyDataSource';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App dataSource={new ApiTopologyDataSource()} />
  </StrictMode>,
);
