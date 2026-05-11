# VSCIVE - Current Implementation Design

This document describes the implementation that is currently present in the repository. It is not a forward-looking target architecture. Where a feature is only partially implemented or intentionally left as a placeholder, that is called out explicitly so the document stays consistent with the code.

## 1. Scope and Runtime Model

VSCIVE is a VS Code custom editor for TASTE / SpaceCreator Interface View diagrams.

The implementation is split into two runtime parts:

- the extension host, which parses, owns, mutates, saves, and restores the document model
- the webview, which renders the diagram with React Flow and sends user intents back to the extension host through typed `postMessage` messages

The extension host is the source of truth. The webview keeps local React state for rendering, selection, transient clipboard, connect mode, and session-local lock state, but persisted document changes are always applied in the extension host first.

## 2. Persisted File Formats

### 2.1 Interface View XML

The main XML document is parsed into `IvModel` and serialized back from that model.

Important persisted entities:

- `Function`
- `Provided_Interface`
- `Required_Interface`
- `Connection`
- `Layer`

Model facts reflected by the current implementation:

- functions may be nested arbitrarily using child `Function` elements
- interfaces belong to functions and are identified by UUID-like string ids
- connections reference interfaces by `iface_id`
- connection endpoint names are duplicated in the XML model as `func_name`, `ri_name`, and `pi_name`
- unknown XML attributes are preserved in `extraAttrs`
- unknown `Property` elements are preserved in `properties`
- `Taste::InheritPI` and `Taste::Autonamed` are mapped to typed boolean fields on interfaces and are serialized back as `Property` elements

The parser accepts connections both at the root level and nested under functions. The serializer writes connections under the nearest common ancestor function of the two endpoint interfaces, with a root-level fallback when there is no common owner.

### 2.2 UI XML

The visual layout is parsed into `UiModel`.

Current layout conventions:

- functions use `coordinates = [x1, y1, x2, y2]`
- interfaces use `coordinates = [x, y]` where the point is the interface center in SpaceCreator space
- connections use `coordinates = [x1, y1, x2, y2, ...]` for routed waypoints
- container functions may also carry `RootCoordinates`, parsed into `rootCoordinates`

`rootCoordinates` are used for modern nested/container layouts. When present, they describe the expanded inner canvas of a container function, and child coordinates are interpreted relative to that inner canvas origin during graph construction.

### 2.3 Legacy Compatibility

Legacy IV files without a separate UI file are supported.

Current behavior:

- if `UiFile` is missing, the document synthesizes `<basename>_ui.xml`
- `Taste::coordinates` properties embedded in the IV file are extracted into a transient `UiModel`
- connection waypoint coordinates embedded as properties are also extracted

This lets the rest of the editor treat modern and legacy files through the same in-memory shape.

### 2.4 Coordinate Conversion

The implementation uses a fixed scale factor:

`SC_SCALE = 0.05`

That means:

- SpaceCreator units are converted to React Flow coordinates by multiplying by `0.05`
- React Flow coordinates are converted back by multiplying by `20`

This conversion is applied at the parse / graph-build boundary and again when persisting layout updates.

## 3. Shared Domain Model

The shared TypeScript model lives in `src/model/types.ts`.

Primary types:

- `IvModel`
- `FunctionModel`
- `InterfaceModel`
- `ConnectionModel`
- `UiModel`
- `EntityLayout`
- `AttributeSchema`
- `EditorOptions`
- `WebviewMessage`
- `ExtensionMessage`

Notable current fields:

- `FunctionModel.nestedFunctions`
- `InterfaceModel.inheritPI`
- `InterfaceModel.autonamed`
- `ConnectionModel.sourceFuncName`
- `ConnectionModel.sourceRiName`
- `ConnectionModel.targetFuncName`
- `ConnectionModel.targetPiName`
- `EntityLayout.rootCoordinates`

The duplicate connection endpoint name fields are actively maintained on rename so persisted XML stays compatible with existing tools.

## 4. Extension-Host Architecture

### 4.1 Entry Point

`src/extension.ts` registers a single custom editor provider:

- view type: `vscive.interfaceViewEditor`
- `supportsMultipleEditorsPerDocument: false`

### 4.2 Provider

`src/editor/InterfaceViewEditorProvider.ts` is responsible for:

- opening custom documents
- creating and resolving the webview
- loading the built webview assets from `out/webview/index.html`
- brokering all webview messages
- saving and reverting documents
- snapshot-based undo/redo integration with VS Code
- persisting editor options in extension `globalState`
- export save dialogs for PNG and SVG

The provider does not use a standalone command-stack class. Undo/redo is implemented directly in the provider with model snapshots.

### 4.3 Document

`src/editor/InterfaceViewDocument.ts` owns the current in-memory document state:

- `iv`
- `ui`
- `schema`

It implements all persisted mutations currently used by the webview, including:

- moving nodes
- adding functions
- adding interfaces
- connecting interfaces
- connecting functions by creating a matched RI/PI pair
- connecting an existing interface to a function by creating a compatible interface
- deleting entities
- updating function fields
- updating interface fields
- pasting functions
- pasting interfaces
- reparenting functions
- updating connection waypoints

### 4.4 Parsers and Serializers

Current parser / serializer modules:

- `src/parsers/IvXmlParser.ts`
- `src/parsers/UiXmlParser.ts`
- `src/parsers/AttrXmlParser.ts`
- `src/serializers/IvXmlSerializer.ts`
- `src/serializers/UiXmlSerializer.ts`

There is no separate config service for the attributes file path; that logic currently lives in `InterfaceViewDocument.loadSchemaFromPath()`.

## 5. Undo, Redo, Save, and Restore

Undo and redo are snapshot-based.

Current implementation details:

- before each persisted mutation, the provider records a deep snapshot of `iv` and `ui`
- after mutation, it records the post-change snapshot
- the provider emits a `CustomDocumentEditEvent` with `undo` and `redo` closures
- undo depth is enforced by monotonic per-document edit serials
- default undo depth is `100`
- current undo depth is configurable through editor options

Save behavior:

- `saveCustomDocument()` writes both the IV XML file and the UI XML file
- `saveCustomDocumentAs()` writes both files next to the chosen destination
- `revertCustomDocument()` reloads from disk and resends the diagram to the active webview

Backup behavior writes only the main IV XML backup payload.

## 6. Options and Configuration

Editor options are represented by `EditorOptions` and stored in extension `globalState`, not in the workspace settings file.

Current persisted options:

- `canvasColor`
- `snapEnabled`
- `snapGridSize`
- `showMinimap`
- `showInterfaceNames`
- `showConnectionLabels`
- `fontSizeFn`
- `fontSizeIface`
- `fontSizeConn`
- `attrFilePath`
- `undoDepth`

The provider merges saved options with `DEFAULT_OPTIONS` on read so newly added fields receive defaults for existing users.

The attributes schema file is resolved in this order:

1. explicit path from the saved options
2. VS Code setting `vscive.attributesFilePath`
3. `$HOME/.local/default_attributes.xml`

## 7. Webview Architecture

### 7.1 General Structure

The webview is a Vite + React application rooted in `webview/src`.

Current state management is local React state plus `useNodesState` / `useEdgesState` from `@xyflow/react`. There is no Zustand store.

Main files:

- `webview/src/App.tsx`
- `webview/src/transform.ts`
- `webview/src/components/Palette.tsx`
- `webview/src/components/OptionsPanel.tsx`
- `webview/src/components/AttributePanel.tsx`
- `webview/src/components/FunctionNode.tsx`
- `webview/src/components/InterfaceNode.tsx`
- `webview/src/components/RoutedEdge.tsx`
- `webview/src/components/WaypointNode.tsx`

### 7.2 Graph Construction

`buildGraph()` converts the persisted model into React Flow elements.

Current graph element types:

- function nodes
- interface nodes
- waypoint nodes for connection routing handles
- routed edges for connections

Waypoint nodes are explicit React Flow nodes so they can be selected with the selection rectangle, dragged, and deleted as part of node selection.

### 7.3 Function Rendering

Functions are rendered as custom rectangular nodes with:

- a header bar
- caption format `name [language]` when language is present
- a body area reserved for nested content
- a `NodeResizer`

Default function size when layout is missing:

- width: `800`
- height: `560`

Nested functions use React Flow parent-child layout via `parentId` and `extent: 'parent'`.

### 7.4 Interface Rendering

Interfaces are rendered as custom triangular nodes positioned just outside the host function border.

Current constants:

- width: `60`
- height: `80`

Current behavior:

- provided interfaces point inward toward the function body
- required interfaces point outward away from the function body
- each interface has one connection handle on the outside side
- interface kind controls icon and color
- interface labels can be shown or hidden via `showInterfaceNames`
- dragging an interface re-snaps it to the nearest edge of the parent function

Required interfaces cannot be set to `Cyclic` in the property panel.

### 7.5 Connection Rendering

Connections are rendered as custom routed edges.

Current behavior:

- the path is a polyline through source, waypoints, and target
- labels are rendered explicitly by the custom edge, not by React Flow's default edge label helper
- connection label background is recomputed on every render from the current connection font size
- labels can be shown or hidden via `showConnectionLabels`
- right-clicking a segment opens a context menu that can add a waypoint or remove the connection

Connection waypoints are stored in the UI model as absolute routed points and exposed in the canvas as dedicated waypoint nodes.

### 7.6 Palette

The palette is a fixed left-side vertical toolbar with icon-only buttons and separators.

Current button order:

- Zoom In
- Zoom Out
- Zoom to Fit
- Snap to Grid
- divider
- Add Function
- Add Provided Interface
- Add Required Interface
- Add Connection
- divider
- Export Diagram as Image
- divider
- Show Options
- Lock Diagram from Modification

Current palette behavior:

- Add Provided / Required Interface is disabled unless a function is selected
- Add Connection toggles a click-based connect mode
- Show Options toggles the options panel
- Lock Diagram is a webview-local toggle and is not persisted into the document or options

### 7.7 Context Menus

Current context menus are:

Canvas:

- Add Function
- Add Connection
- Paste Function (only if the clipboard currently holds a function)
- Build Skeletons
- Build
- Export Diagram as Image

Function:

- Add Provided Interface
- Add Required Interface
- Add Nested Function
- Copy Function
- Paste Interface (only if the clipboard currently holds an interface)
- Move to Root (only when nested)
- Edit Function
- Delete Function

Interface:

- Copy Interface
- Delete Interface

Waypoint node:

- Remove Node
- Remove Connection

Connection segment:

- Add Node
- Remove Connection

### 7.8 Panels

The right-side panel area shows either the options panel or the attribute panel.

Current behavior:

- options panel shows only when `optionsVisible` is true and no entity is selected
- attribute panel shows when a function or interface is selected

The options panel currently edits:

- attributes file path
- canvas background color
- snap toggle
- snap grid size
- show minimap
- show interface names
- show connection labels
- function header font size
- interface label font size
- connection label font size
- undo / redo depth

The attribute panel currently edits:

For functions:

- name
- language
- default implementation
- is type
- fixed system element
- visible schema attributes
- arbitrary function properties list

For interfaces:

- name
- kind
- `inheritPI`
- parameters
- visible schema attributes
- read-only preserved `Property` values

Connected required interfaces show inherited parameters as locked/read-only when a connected PI is present.

`Autonamed` is displayed read-only.

## 8. Interaction Model

### 8.1 Add / Connect Workflows

Functions can be created:

- from the palette
- from the canvas context menu
- as nested functions from the function context menu

Interfaces can be created:

- from the palette for the currently selected function
- from the function context menu
- by dragging a connection from an existing interface onto a function, which creates a compatible interface automatically

Connections can be created in three ways:

1. by dragging between compatible interfaces
2. by dragging from an interface to a function, which creates a compatible interface and connects it
3. by using connect mode, then clicking a source function and a target function to create a matched RI/PI pair and connect them

Connect mode is click-based, not Ctrl-drag based.

### 8.2 Copy / Paste

Clipboard state is webview-local.

Current paste behavior:

- pasted functions receive a new function id
- pasted direct child interfaces of that function also receive new ids
- pasted functions do not copy nested functions
- pasted entities do not copy connections
- pasted interfaces receive a new interface id and no connections

### 8.3 Snapping and Resizing

When snap is enabled:

- node dragging uses React Flow snap-to-grid
- function resize completion snaps the resized rectangle borders to the grid
- interface positions remain constrained to host edges and are re-snapped after parent resize
- the background dot grid uses the configured snap gap

### 8.4 Reparenting

Current reparenting support is one-way through drag of a root function into another root function.

Behavior:

- on drag stop, the editor checks whether the moved root function's center lies inside another root function
- the smallest containing function is chosen as the new parent
- explicit `Move to Root` is available from the context menu for nested functions

The document keeps absolute persisted coordinates and only moves the function in the tree structure.

### 8.5 Locking

The lock toggle currently prevents most mutating UI actions, including:

- adding entities
- deleting entities
- dragging functions and interfaces
- resizing functions
- connection creation
- context-menu mutations
- paste operations
- property editing through the attribute panel

The lock state is not persisted and resets when the webview is reloaded.

## 9. Export

Export is initiated in the provider so the user chooses the destination file first.

Current behavior:

- saving with `.png` exports PNG
- saving with `.svg` exports SVG
- the webview renders the current visible diagram state to SVG markup
- PNG export rasterizes that SVG through a browser canvas
- the export respects current canvas color, label visibility toggles, and current font sizes

## 10. Name Propagation and Inheritance Rules

Current rename propagation:

- renaming a function updates matching connection `sourceFuncName` and `targetFuncName`
- renaming an interface updates matching `sourceRiName`, `targetPiName`, and derived connection names

Current inheritance behavior:

- connecting an RI to a PI calls `syncRequiredInterfaceFromProvided()` before the connection is created
- that routine forces `inheritPI = true`
- it copies interface kind from PI to RI
- it copies parameters when the RI is inheriting or currently empty
- it copies missing preserved properties
- it copies missing or blank extra attributes
- when a provided interface is updated later, connected inheriting required interfaces are synchronized again

## 11. Current Limitations and Placeholders

The following behaviors are intentionally described as current limitations because they are present in the codebase today:

- `Edit Function` is a placeholder and only shows an informational message
- there is no connection-specific properties panel or connection selection model for attribute editing
- function, interface, and connection colors are not user-editable; rendering uses fixed theme colors plus kind-based interface colors
- lock state is session-local and not persisted
- there is no separate undo-stack module or command pattern implementation
- there is no Zustand store in the webview
- attributes file path persistence is implemented through extension global state plus a fallback workspace setting lookup, not through a dedicated config service
- pasted functions do not clone nested function subtrees

## 12. Actual Source Layout

Current top-level source layout:

```text
src/
  extension.ts
  logger.ts
  editor/
    InterfaceViewDocument.ts
    InterfaceViewEditorProvider.ts
  model/
    types.ts
  parsers/
    AttrXmlParser.ts
    IvXmlParser.ts
    UiXmlParser.ts
  serializers/
    IvXmlSerializer.ts
    UiXmlSerializer.ts

webview/
  src/
    App.tsx
    main.tsx
    transform.ts
    waypoints.ts
    components/
      AddEntityDialog.tsx
      AttributePanel.tsx
      ContextMenu.tsx
      EdgeMenuContext.tsx
      FunctionNode.tsx
      InterfaceNode.tsx
      OptionsPanel.tsx
      Palette.tsx
      RoutedEdge.tsx
      WaypointNode.tsx
```

This structure, together with the behavior documented above, is the current implementation baseline.
