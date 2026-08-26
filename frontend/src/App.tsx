import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { InfrastructureObjectDetailPage } from './pages/InfrastructureObjectDetailPage';
import { InfrastructureObjectsPage } from './pages/InfrastructureObjectsPage';
import { MapPage } from './pages/MapPage';
import { NewInfrastructureObjectPage } from './pages/NewInfrastructureObjectPage';
import { NewObjectBlueprintPage } from './pages/NewObjectBlueprintPage';
import { ObjectBlueprintLibraryPage } from './pages/ObjectBlueprintLibraryPage';
import { EditObjectBlueprintPage } from './pages/EditObjectBlueprintPage';
import type { ConnectionPointWriteDataSource } from './topology/connectionPointWriteTypes';
import type { DeviceDetailsDataSource } from './topology/deviceDetailsTypes';
import type { DeviceInterfaceWriteDataSource } from './topology/deviceInterfaceWriteTypes';
import type { DeviceWriteDataSource } from './topology/deviceWriteTypes';
import type { TopologyLayoutStore } from './topology/layoutStore';
import type { PhysicalEndpointConnectionWriteDataSource } from './topology/physicalEndpointConnectionWriteTypes';
import type { PhysicalLinkWriteDataSource } from './topology/physicalLinkWriteTypes';
import type { PhysicalObjectClassWriteDataSource } from './topology/physicalObjectClassWriteTypes';
import type { PhysicalObjectDetailsDataSource } from './topology/physicalObjectDetailsTypes';
import type { PhysicalObjectWriteDataSource } from './topology/physicalObjectWriteTypes';
import type { TopologyDataSource } from './topology/types';
import type { PhysicalObjectL1TraceDataSource } from './topology/physicalObjectL1TraceTypes';
import type { L2ForwardingContextWriteDataSource } from './topology/l2ForwardingContextWriteTypes';
import type { ObjectBlueprintDataSource } from './topology/objectBlueprintTypes';
import type { PhysicalObjectDeleteDataSource } from './topology/physicalObjectDeleteTypes';
import type { SavedMapDataSource } from './topology/savedMapTypes';
import type { CatalogInventoryDataSource } from './topology/catalogInventoryTypes';
import type { PhysicalObjectDisplayNameWriteDataSource } from './topology/physicalObjectDisplayNameWriteTypes';
import type { BlueprintUpgradeDataSource } from './topology/blueprintUpgradeTypes';
import type { PortBlockDataSource } from './topology/portBlockTypes';
import { PortBlockLibraryPage } from './pages/PortBlockLibraryPage';
import { PortBlockEditorPage } from './pages/PortBlockEditorPage';

export interface AppProps {
  dataSource: TopologyDataSource;
  deviceDetailsDataSource: DeviceDetailsDataSource;
  traceDataSource?: PhysicalObjectL1TraceDataSource;
  deviceWriteDataSource?: DeviceWriteDataSource;
  deviceInterfaceWriteDataSource?: DeviceInterfaceWriteDataSource;
  physicalLinkWriteDataSource?: PhysicalLinkWriteDataSource;
  physicalObjectDetailsDataSource?: PhysicalObjectDetailsDataSource;
  physicalEndpointConnectionWriteDataSource?: PhysicalEndpointConnectionWriteDataSource;
  physicalObjectWriteDataSource?: PhysicalObjectWriteDataSource;
  physicalObjectClassWriteDataSource?: PhysicalObjectClassWriteDataSource;
  connectionPointWriteDataSource?: ConnectionPointWriteDataSource;
  topologyLayoutStore?: TopologyLayoutStore;
  l2ForwardingContextWriteDataSource?: L2ForwardingContextWriteDataSource;
  objectBlueprintDataSource?: ObjectBlueprintDataSource;
  physicalObjectDeleteDataSource?: PhysicalObjectDeleteDataSource;
  savedMapDataSource?: SavedMapDataSource;
  catalogInventoryDataSource: CatalogInventoryDataSource;
  physicalObjectDisplayNameWriteDataSource?: PhysicalObjectDisplayNameWriteDataSource;
  blueprintUpgradeDataSource?: BlueprintUpgradeDataSource;
  portBlockDataSource?: PortBlockDataSource;
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
            physicalObjectDetailsDataSource={props.physicalObjectDetailsDataSource}
            physicalEndpointConnectionWriteDataSource={props.physicalEndpointConnectionWriteDataSource}
            savedMapDataSource={props.savedMapDataSource}
            catalogInventoryDataSource={props.catalogInventoryDataSource}
          />}
        />
        <Route
          path="infrastructure/objects"
          element={<InfrastructureObjectsPage catalogInventoryDataSource={props.catalogInventoryDataSource} physicalObjectDeleteDataSource={props.physicalObjectDeleteDataSource} physicalObjectDisplayNameWriteDataSource={props.physicalObjectDisplayNameWriteDataSource} />}
        />
        <Route path="library/object-blueprints" element={props.objectBlueprintDataSource ? <ObjectBlueprintLibraryPage dataSource={props.objectBlueprintDataSource} /> : <Navigate replace to="/map" />} />
        <Route path="library/object-blueprints/new" element={props.objectBlueprintDataSource && props.portBlockDataSource ? <NewObjectBlueprintPage dataSource={props.objectBlueprintDataSource} portBlockDataSource={props.portBlockDataSource} /> : <Navigate replace to="/map" />} />
        <Route path="library/object-blueprints/:blueprintId/versions/:versionId/edit" element={props.objectBlueprintDataSource && props.portBlockDataSource ? <EditObjectBlueprintPage dataSource={props.objectBlueprintDataSource} portBlockDataSource={props.portBlockDataSource} /> : <Navigate replace to="/map" />} />
        <Route path="library/port-blocks" element={props.portBlockDataSource ? <PortBlockLibraryPage dataSource={props.portBlockDataSource} /> : <Navigate replace to="/map" />} />
        <Route path="library/port-blocks/new" element={props.portBlockDataSource ? <PortBlockEditorPage dataSource={props.portBlockDataSource} mode="new" /> : <Navigate replace to="/map" />} />
        <Route path="library/port-blocks/:portBlockId/versions/:versionId/edit" element={props.portBlockDataSource ? <PortBlockEditorPage dataSource={props.portBlockDataSource} mode="version" /> : <Navigate replace to="/map" />} />
        <Route
          path="infrastructure/objects/new"
          element={(
            <NewInfrastructureObjectPage
              deviceWriteDataSource={props.deviceWriteDataSource}
              physicalObjectWriteDataSource={props.physicalObjectWriteDataSource}
              objectBlueprintDataSource={props.objectBlueprintDataSource}
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
              blueprintUpgradeDataSource={props.blueprintUpgradeDataSource}
              objectBlueprintDataSource={props.objectBlueprintDataSource}
            />
          )}
        />
        <Route path="*" element={<Navigate replace to="/map" />} />
      </Route>
    </Routes>
  );
}
