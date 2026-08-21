import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiTopologyDataSource } from './topology/apiTopologyDataSource';
import { ApiDeviceDetailsDataSource } from './topology/apiDeviceDetailsDataSource';
import { ApiDeviceWriteDataSource } from './topology/apiDeviceWriteDataSource';
import { ApiDeviceInterfaceWriteDataSource } from './topology/apiDeviceInterfaceWriteDataSource';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      dataSource={new ApiTopologyDataSource()}
      deviceDetailsDataSource={new ApiDeviceDetailsDataSource()}
      deviceWriteDataSource={new ApiDeviceWriteDataSource()}
      deviceInterfaceWriteDataSource={new ApiDeviceInterfaceWriteDataSource()}
    />
  </StrictMode>,
);
