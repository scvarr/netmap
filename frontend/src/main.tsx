import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiTopologyDataSource } from './topology/apiTopologyDataSource';
import { ApiDeviceDetailsDataSource } from './topology/apiDeviceDetailsDataSource';
import { ApiDeviceWriteDataSource } from './topology/apiDeviceWriteDataSource';
import { ApiDeviceInterfaceWriteDataSource } from './topology/apiDeviceInterfaceWriteDataSource';
import { ApiPhysicalLinkWriteDataSource } from './topology/apiPhysicalLinkWriteDataSource';
import { ApiPhysicalObjectDetailsDataSource } from './topology/apiPhysicalObjectDetailsDataSource';
import { ApiPhysicalObjectWriteDataSource } from './topology/apiPhysicalObjectWriteDataSource';
import { ApiPhysicalEndpointConnectionWriteDataSource } from './topology/apiPhysicalEndpointConnectionWriteDataSource';
import { BrowserTopologyLayoutStore } from './topology/layoutStore';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      dataSource={new ApiTopologyDataSource()}
      deviceDetailsDataSource={new ApiDeviceDetailsDataSource()}
      deviceWriteDataSource={new ApiDeviceWriteDataSource()}
      deviceInterfaceWriteDataSource={new ApiDeviceInterfaceWriteDataSource()}
      physicalLinkWriteDataSource={new ApiPhysicalLinkWriteDataSource()}
      physicalObjectDetailsDataSource={new ApiPhysicalObjectDetailsDataSource()}
      physicalObjectWriteDataSource={new ApiPhysicalObjectWriteDataSource()}
      physicalEndpointConnectionWriteDataSource={new ApiPhysicalEndpointConnectionWriteDataSource()}
      topologyLayoutStore={new BrowserTopologyLayoutStore(window.localStorage)}
    />
  </StrictMode>,
);
