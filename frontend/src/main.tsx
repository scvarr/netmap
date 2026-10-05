import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiTopologyDataSource } from './topology/apiTopologyDataSource';
import { ApiDeviceDetailsDataSource } from './topology/apiDeviceDetailsDataSource';
import { ApiDeviceInterfaceWriteDataSource } from './topology/apiDeviceInterfaceWriteDataSource';
import { ApiPhysicalLinkWriteDataSource } from './topology/apiPhysicalLinkWriteDataSource';
import { ApiPhysicalObjectDetailsDataSource } from './topology/apiPhysicalObjectDetailsDataSource';
import { ApiPhysicalEndpointConnectionWriteDataSource } from './topology/apiPhysicalEndpointConnectionWriteDataSource';
import { ApiPhysicalObjectClassWriteDataSource } from './topology/apiPhysicalObjectClassWriteDataSource';
import { BrowserTopologyLayoutStore } from './topology/layoutStore';
import { ApiConnectionPointWriteDataSource } from './topology/apiConnectionPointWriteDataSource';
import { ApiPhysicalObjectL1TraceDataSource } from './topology/apiPhysicalObjectL1TraceDataSource';
import { ApiL2ForwardingContextWriteDataSource } from './topology/apiL2ForwardingContextWriteDataSource';
import { ApiBaseTemplateDataSource } from './topology/apiBaseTemplateDataSource';
import { ApiPhysicalObjectDeleteDataSource } from './topology/apiPhysicalObjectDeleteDataSource';
import { ApiSavedMapDataSource } from './topology/apiSavedMapDataSource';
import { ApiCatalogInventoryDataSource } from './topology/apiCatalogInventoryDataSource';
import { ApiPhysicalObjectDisplayNameWriteDataSource } from './topology/apiPhysicalObjectDisplayNameWriteDataSource';
import { ApiCableDeleteDataSource } from './topology/apiCableDeleteDataSource';
import { ApiLocationDataSource } from './topology/apiLocationDataSource';
import { ApiCableLabelDataSource } from './topology/apiCableLabelDataSource';
import './styles.css';
import { I18nProvider } from './i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider><App
        dataSource={new ApiTopologyDataSource()}
        deviceDetailsDataSource={new ApiDeviceDetailsDataSource()}
        traceDataSource={new ApiPhysicalObjectL1TraceDataSource()}
        deviceInterfaceWriteDataSource={new ApiDeviceInterfaceWriteDataSource()}
        physicalLinkWriteDataSource={new ApiPhysicalLinkWriteDataSource()}
        physicalObjectDetailsDataSource={new ApiPhysicalObjectDetailsDataSource()}
        physicalEndpointConnectionWriteDataSource={new ApiPhysicalEndpointConnectionWriteDataSource()}
        physicalObjectClassWriteDataSource={new ApiPhysicalObjectClassWriteDataSource()}
        connectionPointWriteDataSource={new ApiConnectionPointWriteDataSource()}
        l2ForwardingContextWriteDataSource={new ApiL2ForwardingContextWriteDataSource()}
        baseTemplateDataSource={new ApiBaseTemplateDataSource()}
        physicalObjectDeleteDataSource={new ApiPhysicalObjectDeleteDataSource()}
        cableDeleteDataSource={new ApiCableDeleteDataSource()}
        savedMapDataSource={new ApiSavedMapDataSource()}
        catalogInventoryDataSource={new ApiCatalogInventoryDataSource()}
        physicalObjectDisplayNameWriteDataSource={new ApiPhysicalObjectDisplayNameWriteDataSource()}
        locationDataSource={new ApiLocationDataSource()}
        cableLabelDataSource={new ApiCableLabelDataSource()}
        topologyLayoutStore={new BrowserTopologyLayoutStore(window.localStorage)}
      /></I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
