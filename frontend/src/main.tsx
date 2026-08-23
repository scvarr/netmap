import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiTopologyDataSource } from './topology/apiTopologyDataSource';
import { ApiDeviceDetailsDataSource } from './topology/apiDeviceDetailsDataSource';
import { ApiDeviceWriteDataSource } from './topology/apiDeviceWriteDataSource';
import { ApiDeviceInterfaceWriteDataSource } from './topology/apiDeviceInterfaceWriteDataSource';
import { ApiPhysicalLinkWriteDataSource } from './topology/apiPhysicalLinkWriteDataSource';
import { ApiPhysicalObjectDetailsDataSource } from './topology/apiPhysicalObjectDetailsDataSource';
import { ApiPhysicalObjectWriteDataSource } from './topology/apiPhysicalObjectWriteDataSource';
import { ApiPhysicalEndpointConnectionWriteDataSource } from './topology/apiPhysicalEndpointConnectionWriteDataSource';
import { ApiPhysicalObjectClassWriteDataSource } from './topology/apiPhysicalObjectClassWriteDataSource';
import { BrowserTopologyLayoutStore } from './topology/layoutStore';
import { ApiConnectionPointWriteDataSource } from './topology/apiConnectionPointWriteDataSource';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App
        dataSource={new ApiTopologyDataSource()}
        deviceDetailsDataSource={new ApiDeviceDetailsDataSource()}
        deviceWriteDataSource={new ApiDeviceWriteDataSource()}
        deviceInterfaceWriteDataSource={new ApiDeviceInterfaceWriteDataSource()}
        physicalLinkWriteDataSource={new ApiPhysicalLinkWriteDataSource()}
        physicalObjectDetailsDataSource={new ApiPhysicalObjectDetailsDataSource()}
        physicalObjectWriteDataSource={new ApiPhysicalObjectWriteDataSource()}
        physicalEndpointConnectionWriteDataSource={new ApiPhysicalEndpointConnectionWriteDataSource()}
        physicalObjectClassWriteDataSource={new ApiPhysicalObjectClassWriteDataSource()}
        connectionPointWriteDataSource={new ApiConnectionPointWriteDataSource()}
        topologyLayoutStore={new BrowserTopologyLayoutStore(window.localStorage)}
      />
    </BrowserRouter>
  </StrictMode>,
);
