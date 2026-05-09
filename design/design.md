# VSCIVE — Solution Design

## 1. File Format (derived from references)

The SpaceCreator Interface View uses **two XML files per diagram**:

### `interfaceview.xml` — domain model
```
<InterfaceView version="1.3" asn1file="..." UiFile="interfaceview.ui.xml" modifierHash="...">
  <Function id="{uuid}" name="..." language="C" is_type="NO" ...>
    <Provided_Interface id="{uuid}" name="..." kind="Sporadic|Cyclic|Protected|Unprotected" ...>
      <Input_Parameter name="..." type="..." encoding="..."/>
      <Output_Parameter .../>
      <Property name="..." value="..."/>       <!-- arbitrary round-trip properties -->
    </Provided_Interface>
    <Required_Interface ...>
      <Property name="Taste::InheritPI" value="true"/>  <!-- REQ-0081 marker -->
      <Property name="Taste::Autonamed" value="true"/>
    </Required_Interface>
    <Function ...>                             <!-- nested Function (arbitrary depth) -->
      ...
    </Function>
    <Implementations>
      <Implementation name="default" language="C"/>
    </Implementations>
    <Property name="..." value="..."/>         <!-- e.g. TASTE_IV_Properties::Default_Codegen -->
  </Function>
  <Connection id="{uuid}" name="..." ...>
    <Source iface_id="{uuid}" func_name="..." ri_name="..."/>
    <Target iface_id="{uuid}" func_name="..." pi_name="..."/>
  </Connection>
  <Layer name="default" is_visible="true"/>
</InterfaceView>
```

Key observations:
- **Nesting** is encoded by child `<Function>` elements inside parent `<Function>` — arbitrary depth.
- Connections are **flat** (always at root level), referencing interfaces by UUID across any nesting level.
- **Round-trip preservation** of unknown XML attributes and `<Property>` children is required by REQ-0300.
- `Taste::InheritPI=true` is the serialization marker for the REQ-0081 "inherit from PI" flag.

### `interfaceview.ui.xml` — visual layout (separate file)
```
<UI version="1.0">
  <Entity id="{function-uuid}">
    <Taste coordinates="x1 y1 x2 y2"/>        <!-- bounding box -->
  </Entity>
  <Entity id="{interface-uuid}">
    <Taste coordinates="x y"/>                 <!-- single point on parent's edge -->
  </Entity>
  <Entity id="{connection-uuid}">
    <Taste coordinates="x1 y1 x2 y2 x3 y3 ..."/> <!-- polyline waypoints -->
  </Entity>
</UI>
```

- Coordinates are integers in a large logical space (~1000 units = ~1 pixel at default zoom).
- Interface position is a single point; which edge it belongs to is inferred from proximity to the parent Function's bounding box.
- The UI file is referenced from the data file via `UiFile="..."`.

### `default_attributes.xml` — attribute schema
```
<Attrs>
  <Attr label="Language" name="language" visible="false">
    <Scopes><Function/></Scopes>
    <Type>
      <Enumeration defaultValue="SDL">
        <Entry value="C"/>  <Entry value="Ada"/>  ...
      </Enumeration>
    </Type>
  </Attr>
  <Attr label="Comment" name="Comment" visible="true">
    <Scopes><Function/><Provided_Interface/><Required_Interface/></Scopes>
    <Type><String/></Type>
  </Attr>
</Attrs>
```

---

## 2. Architecture Overview

```
VS Code Extension Host (Node.js)
│
├── InterfaceViewEditorProvider   (CustomEditorProvider)
│     registers for *.xml with <InterfaceView> content
│
├── InterfaceViewDocument         (CustomDocument)
│     owns parsed IvModel + UiModel + AttributeSchema
│     tracks dirty state, handles save, undo/redo stack
│
├── Parsers / Serializers
│     IvXmlParser    interfaceview.xml  → IvModel
│     UiXmlParser    interfaceview.ui.xml → UiModel
│     AttrXmlParser  default_attributes.xml → AttributeSchema
│     IvXmlSerializer  IvModel → interfaceview.xml
│     UiXmlSerializer  UiModel → interfaceview.ui.xml
│
└── WebviewPanel  (React SPA, served from extension)
      ↕  postMessage (JSON)
      DiagramApp
      ├── Palette panel (Function, PI, RI drag sources)
      ├── React Flow canvas
      │     FunctionNode (custom, nestable via parentNode)
      │     InterfaceHandle (edge-snapped sub-node)
      │     ConnectionEdge (custom, polyline waypoints)
      └── AttributePanel (edit selected entity's attributes)
```

Communication is strictly bidirectional JSON messages over the VS Code webview `postMessage` API. The extension is the single source of truth; the webview is a view/controller only.

---

## 3. Domain Model (TypeScript interfaces)

```typescript
// Shared between extension and webview (placed in src/model/)

interface IvModel {
  version: string;
  asn1file: string;
  uiFile: string;
  modifierHash: string;
  functions: FunctionModel[];   // top-level only; nested are children
  connections: ConnectionModel[];
  layers: LayerModel[];
  unknownXmlAttrs: Record<string, string>;  // REQ-0300
}

interface FunctionModel {
  id: string;             // UUID
  name: string;
  language: string;
  defaultImplementation: string;
  isType: boolean;
  fixedSystemElement: boolean;
  requiredSystemElement: boolean;
  providedInterfaces: InterfaceModel[];
  requiredInterfaces: InterfaceModel[];
  nestedFunctions: FunctionModel[];
  implementations: ImplementationModel[];
  properties: PropertyModel[];     // round-trip
  extraAttrs: Record<string, string>; // from Attributes file + unknown
}

interface InterfaceModel {
  id: string;
  name: string;
  type: 'provided' | 'required';
  kind: 'Cyclic' | 'Sporadic' | 'Protected' | 'Unprotected';
  parameters: ParameterModel[];
  inheritPI: boolean;       // Taste::InheritPI
  autonamed: boolean;       // Taste::Autonamed
  properties: PropertyModel[];
  extraAttrs: Record<string, string>;
}

type ParameterEncoding = 'NATIVE' | 'ACN' | 'UPER';

interface ParameterModel {
  name: string;
  type: string;             // ASN.1 type name
  direction: 'input' | 'output';
  encoding: ParameterEncoding;  // default: 'NATIVE'; serialized as plain string; UI presents a dropdown with NATIVE, ACN, UPER
}

interface ConnectionModel {
  id: string;
  name: string;
  sourceIfaceId: string;
  sourceFuncName: string;
  targetIfaceId: string;
  targetFuncName: string;
  properties: PropertyModel[];
  extraAttrs: Record<string, string>;
}

// UI model (layout, lives in interfaceview.ui.xml)
interface UiModel {
  entities: Map<string, EntityLayout>;  // keyed by entity UUID
}

interface EntityLayout {
  // Function: {x, y, width, height}; Interface: {x, y}; Connection: waypoints[]
  coordinates: number[];
}

// Attribute schema (from default_attributes.xml)
interface AttributeSchema {
  attrs: AttrDef[];
}

interface AttrDef {
  label: string;
  name: string;
  visible: boolean;
  scopes: EntityScope[];
  type: EnumerationType | StringType;
}
```

---

## 4. Module Structure

```
src/
  extension.ts                     entry point, registers providers
  editor/
    InterfaceViewEditorProvider.ts  CustomEditorProvider
    InterfaceViewDocument.ts        CustomDocument + undo/redo stack
    UndoStack.ts                    Command pattern, configurable depth (REQ-0340/0350)
  model/                           shared TS interfaces (above)
  parsers/
    IvXmlParser.ts
    UiXmlParser.ts
    AttrXmlParser.ts
  serializers/
    IvXmlSerializer.ts
    UiXmlSerializer.ts
  config/
    AttributesFileConfig.ts         reads VS Code setting for path (REQ-0240/0250)

webview/                           separate Vite + React build target
  src/
    main.tsx                        ReactDOM.createRoot entry
    App.tsx                         receives/sends postMessage, owns diagram state
    store/
      diagramStore.ts               Zustand store (nodes, edges, selection)
    components/
      canvas/
        DiagramCanvas.tsx           ReactFlow wrapper
        FunctionNode.tsx            custom node: resizable, nestable, color (REQ-0190/0200)
        InterfaceNode.tsx           edge-snapped sub-node (REQ-0160)
        ConnectionEdge.tsx          custom edge with waypoints (REQ-0150)
      panels/
        Palette.tsx                 draggable Function/PI/RI palette (REQ-0071)
        AttributePanel.tsx          form for selected entity (REQ-0210)
        InterfaceParamList.tsx      reorderable param list (REQ-0220)
    hooks/
      useEdgeSnap.ts                snaps Interface nodes to parent Function edges
      useCtrlDrag.ts                Ctrl+drag quick-connect gesture (REQ-0082)
    messages.ts                     typed postMessage protocol (extension ↔ webview)
```

---

## 5. Build System

Two independent compilation targets:

| Target | Tool | Output |
|--------|------|--------|
| Extension host | `tsc` | `out/` |
| Webview SPA | `vite build` | `out/webview/` |

The Makefile gains a `build-webview` target; `build` depends on both. The webview is bundled into the `.vsix` as a static asset.

---

## 6. Key Design Decisions

### 6.1 Two-file persistence
The UI file (`interfaceview.ui.xml`) is written alongside the data file on every save, matching SpaceCreator's convention. The `CustomDocument` treats both files as a single logical document.

### 6.2 Nesting in React Flow
Parent Functions are React Flow nodes. Nested Functions use `parentNode` + `extent: 'parent'`. Interface nodes are also React Flow nodes with `parentNode` set to their Function, snapped to the nearest edge by `useEdgeSnap`. This means the canvas contains three kinds of React Flow nodes: Function, Interface, and no explicit Connection node (Connections are React Flow edges).

### 6.3 Coordinate system
SpaceCreator stores coordinates in units where 1000 ≈ a modest screen pixel distance. A fixed scale factor of `0.05` (1 SPC unit → 0.05 px) converts to React Flow space on load, and the inverse on save. This can be tuned.

### 6.4 Round-trip preservation (REQ-0300)
The XML parser captures all unknown XML attributes into `extraAttrs` maps and all `<Property>` children into `properties` arrays. The serializer emits them verbatim. The webview never sees or touches these fields.

### 6.5 REQ-0081 — Interface inheritance
When a Connection is created between a RI and a PI, the extension automatically copies `kind`, `parameters`, and `extraAttrs` from the PI to the RI, unless the RI field is already non-default. It sets `Taste::InheritPI=true` on the RI. The user can override any inherited field afterward.

### 6.6 REQ-0140 — Nested connections
Connections in the XML always reference interfaces by UUID regardless of nesting depth — there is no propagation interface concept in the file format. In the UI, connections crossing nesting boundaries are drawn through the parent Function border. The editor enforces this visually only; the serialization is identical to non-nested connections.

### 6.7 Undo/redo (REQ-0340/0350)
The `UndoStack` lives in the extension host (the source of truth). Each user action from the webview is converted to a reversible `Command` object before being applied to the model. The webview sends intents; the extension applies, records, and pushes the updated model back.

### 6.8 Save semantics
The extension implements `CustomEditorProvider` with `supportsMultipleEditorsPerDocument: false`. Saving is triggered by VS Code's standard Ctrl+S, which calls `saveCustomDocument`. Auto-save follows VS Code's global auto-save setting automatically.

### 6.9 Attributes file path (REQ-0250)
The default `$HOME/.local/default_attributes.xml` is resolved at runtime using `process.env.HOME`. The path is exposed as a VS Code workspace setting `vscive.attributesFilePath`.
