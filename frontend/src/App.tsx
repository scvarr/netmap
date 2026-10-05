import { NewModuleTemplatePage } from './pages/NewModuleTemplatePage';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { InfrastructureObjectDetailPage } from './pages/InfrastructureObjectDetailPage';
import { InfrastructureObjectsPage } from './pages/InfrastructureObjectsPage';
import { MapPage } from './pages/MapPage';
import { NewInfrastructureObjectPage } from './pages/NewInfrastructureObjectPage';
import { NewBaseTemplatePage } from './pages/NewBaseTemplatePage';
import { BaseTemplateLibraryPage } from './pages/BaseTemplateLibraryPage';
import type { ConnectionPointWriteDataSource } from './topology/connectionPointWriteTypes';
import type { DeviceDetailsDataSource } from './topology/deviceDetailsTypes';
import type { DeviceInterfaceWriteDataSource } from './topology/deviceInterfaceWriteTypes';
import type { TopologyLayoutStore } from './topology/layoutStore';
import type { PhysicalEndpointConnectionWriteDataSource } from './topology/physicalEndpointConnectionWriteTypes';
import type { PhysicalLinkWriteDataSource } from './topology/physicalLinkWriteTypes';
import type { PhysicalObjectClassWriteDataSource } from './topology/physicalObjectClassWriteTypes';
import type { PhysicalObjectDetailsDataSource } from './topology/physicalObjectDetailsTypes';
import type { TopologyDataSource } from './topology/types';
import type { PhysicalObjectL1TraceDataSource } from './topology/physicalObjectL1TraceTypes';
import type { L2ForwardingContextWriteDataSource } from './topology/l2ForwardingContextWriteTypes';
import type { BaseTemplateDataSource } from './topology/baseTemplateTypes';
import type { PhysicalObjectDeleteDataSource } from './topology/physicalObjectDeleteTypes';
import type { SavedMapDataSource } from './topology/savedMapTypes';
import type { CatalogInventoryDataSource } from './topology/catalogInventoryTypes';
import type { PhysicalObjectDisplayNameWriteDataSource } from './topology/physicalObjectDisplayNameWriteTypes';
import type { CableDeleteDataSource } from './topology/cableDeleteTypes';
import { LocationsPage } from './pages/LocationsPage';
import { CableLabelTemplatesPage } from './pages/CableLabelTemplatesPage';
import { WorkspaceDataPage } from './pages/WorkspaceDataPage';
import type { LocationDataSource } from './topology/locationTypes';
import type { CableLabelDataSource } from './topology/cableLabelTypes';

export interface AppProps {
  dataSource: TopologyDataSource;
  deviceDetailsDataSource: DeviceDetailsDataSource;
  traceDataSource?: PhysicalObjectL1TraceDataSource;
  deviceInterfaceWriteDataSource?: DeviceInterfaceWriteDataSource;
  physicalLinkWriteDataSource?: PhysicalLinkWriteDataSource;
  physicalObjectDetailsDataSource?: PhysicalObjectDetailsDataSource;
  physicalEndpointConnectionWriteDataSource?: PhysicalEndpointConnectionWriteDataSource;
  physicalObjectClassWriteDataSource?: PhysicalObjectClassWriteDataSource;
  connectionPointWriteDataSource?: ConnectionPointWriteDataSource;
  topologyLayoutStore?: TopologyLayoutStore;
  l2ForwardingContextWriteDataSource?: L2ForwardingContextWriteDataSource;
  baseTemplateDataSource?: BaseTemplateDataSource;
  physicalObjectDeleteDataSource?: PhysicalObjectDeleteDataSource;
  cableDeleteDataSource?: CableDeleteDataSource;
  savedMapDataSource?: SavedMapDataSource;
  catalogInventoryDataSource: CatalogInventoryDataSource;
  physicalObjectDisplayNameWriteDataSource?: PhysicalObjectDisplayNameWriteDataSource;
  locationDataSource?: LocationDataSource;
  cableLabelDataSource?: CableLabelDataSource;
}

export function App(props: AppProps) {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate replace to="/map" />} />
        <Route
          path="map"
          element={<MapPage
            dataSource={props.dataSource}
            traceDataSource={props.traceDataSource}
            topologyLayoutStore={props.topologyLayoutStore}
            physicalObjectDeleteDataSource={props.physicalObjectDeleteDataSource}
            cableDeleteDataSource={props.cableDeleteDataSource}
            physicalObjectDetailsDataSource={props.physicalObjectDetailsDataSource}
            physicalEndpointConnectionWriteDataSource={props.physicalEndpointConnectionWriteDataSource}
            savedMapDataSource={props.savedMapDataSource}
            locationDataSource={props.locationDataSource}
            catalogInventoryDataSource={props.catalogInventoryDataSource}
            cableLabelDataSource={props.cableLabelDataSource}
          />}
        />
        <Route
          path="infrastructure/objects"
          element={<InfrastructureObjectsPage catalogInventoryDataSource={props.catalogInventoryDataSource} physicalObjectDeleteDataSource={props.physicalObjectDeleteDataSource} cableDeleteDataSource={props.cableDeleteDataSource} physicalObjectDisplayNameWriteDataSource={props.physicalObjectDisplayNameWriteDataSource} cableLabelDataSource={props.cableLabelDataSource} />}
        />
        <Route path="infrastructure/locations" element={props.locationDataSource ? <LocationsPage dataSource={props.locationDataSource} /> : <Navigate replace to="/map" />} />
        <Route path="infrastructure/cable-label-templates" element={props.cableLabelDataSource ? <CableLabelTemplatesPage dataSource={props.cableLabelDataSource} /> : <Navigate replace to="/map" />} />
        <Route path="settings/data" element={<WorkspaceDataPage />} />
        <Route path="library/base-templates" element={props.baseTemplateDataSource ? <BaseTemplateLibraryPage dataSource={props.baseTemplateDataSource} /> : <Navigate replace to="/map" />} />
        <Route path="library/module-templates/new" element={<NewModuleTemplatePage />} />
        <Route path="library/base-templates/new" element={props.baseTemplateDataSource ? <NewBaseTemplatePage dataSource={props.baseTemplateDataSource} /> : <Navigate replace to="/map" />} />
        <Route
          path="infrastructure/objects/new"
          element={(
            <NewInfrastructureObjectPage
              baseTemplateDataSource={props.baseTemplateDataSource}
              locationDataSource={props.locationDataSource}
            />
          )}
        />
        <Route
          path="infrastructure/objects/:physicalObjectId"
          element={(
            <InfrastructureObjectDetailPage
              dataSource={props.dataSource}
              deviceDetailsDataSource={props.deviceDetailsDataSource}
              physicalObjectDetailsDataSource={props.physicalObjectDetailsDataSource}
              deviceInterfaceWriteDataSource={props.deviceInterfaceWriteDataSource}
              physicalLinkWriteDataSource={props.physicalLinkWriteDataSource}
              physicalEndpointConnectionWriteDataSource={props.physicalEndpointConnectionWriteDataSource}
              physicalObjectClassWriteDataSource={props.physicalObjectClassWriteDataSource}
              connectionPointWriteDataSource={props.connectionPointWriteDataSource}
              l2ForwardingContextWriteDataSource={props.l2ForwardingContextWriteDataSource}
              catalogInventoryDataSource={props.catalogInventoryDataSource}
              savedMapDataSource={props.savedMapDataSource}
              baseTemplateDataSource={props.baseTemplateDataSource}
              locationDataSource={props.locationDataSource}
              cableLabelDataSource={props.cableLabelDataSource}
            />
          )}
        />
        <Route
          path="infrastructure/objects/:physicalObjectId/:section"
          element={(
            <InfrastructureObjectDetailPage
              dataSource={props.dataSource}
              deviceDetailsDataSource={props.deviceDetailsDataSource}
              physicalObjectDetailsDataSource={props.physicalObjectDetailsDataSource}
              deviceInterfaceWriteDataSource={props.deviceInterfaceWriteDataSource}
              physicalLinkWriteDataSource={props.physicalLinkWriteDataSource}
              physicalEndpointConnectionWriteDataSource={props.physicalEndpointConnectionWriteDataSource}
              physicalObjectClassWriteDataSource={props.physicalObjectClassWriteDataSource}
              connectionPointWriteDataSource={props.connectionPointWriteDataSource}
              l2ForwardingContextWriteDataSource={props.l2ForwardingContextWriteDataSource}
              catalogInventoryDataSource={props.catalogInventoryDataSource}
              savedMapDataSource={props.savedMapDataSource}
              baseTemplateDataSource={props.baseTemplateDataSource}
              locationDataSource={props.locationDataSource}
              cableLabelDataSource={props.cableLabelDataSource}
            />
          )}
        />
        <Route path="*" element={<Navigate replace to="/map" />} />
      </Route>
    </Routes>
  );
}
