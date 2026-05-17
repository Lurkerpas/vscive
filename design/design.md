# VSCIVE: Implementation Design

This document provides an overview of VSCIVE design.

## 1) Purpose and Scope

VSCIVE is a VS Code extension providing two custom editors:

- Interface View editor for `interfaceview.xml`
- Deployment View editor for `*.dv.xml`

Both editors support diagram editing, XML round-trip serialization, image export, and build/run integration through shell commands (optionally wrapped by `scripts/taste-cli.sh`).

## 2) Main Libraries and Tooling

Runtime libraries:

- VS Code Extension API (`vscode`): activation, custom editors, commands, file I/O, webview host
- React + React DOM: webview UI
- `@xyflow/react` (React Flow): diagram/canvas interaction and node/edge rendering
- `@xmldom/xmldom`: XML parse/manipulation in the extension host and test helpers

Build/tooling:

- TypeScript
- esbuild: extension bundles (`out/extension-node.js`, `out/extension-web.js`)
- Vite + `@vitejs/plugin-react`: webview bundle (`out/webview/assets/main.js`, `main.css`)
- Node test runner for unit/integration-style tests in `test/`

## 3) High-Level Architecture

The implementation is split into two runtime parts:

- Extension host (authoritative model/state and persistence)
- Webview app (diagram rendering, interaction, transient UI state)

The extension host is the source of truth. Webviews emit typed intent messages; documents mutate in host memory first; host then pushes a refreshed model back to the webview.

### 3.1 Extension Entry and Registration

`src/extension.ts`:

- Registers custom editors:
  - `vscive.interfaceViewEditor` via `InterfaceViewEditorProvider`
  - `vscive.deploymentViewEditor` via `DeploymentViewEditorProvider`
- Registers explorer commands (create IV/DV, taste init/build/run)
- Resolves folder targets and executes terminal commands via shared terminal helper

### 3.2 Custom Editor Providers

`src/editor/InterfaceViewEditorProvider.ts`:

- Handles webview lifecycle, message routing, save/revert/backup
- Implements snapshot-based undo/redo with undo-depth limiting
- Persists options in `globalState`
- Supports IV build actions, including `CLI` action when taste-cli wrapping is enabled
- Supports function source opening (`Edit Function`) for Ada/C/C++

`src/editor/DeploymentViewEditorProvider.ts`:

- Handles DV webview lifecycle and messages
- Snapshot-based undo/redo
- Persists options in `globalState`
- Supports DV build actions and `CLI` mode via `buildDv` message

### 3.3 Document Model Owners

`src/editor/InterfaceViewDocument.ts`:

- Owns `iv`, `ui`, and attribute `schema`
- Loads modern IV+UI or synthesizes UI from legacy embedded `Taste::coordinates`
- Applies all IV mutations (add/update/delete/move/connect/paste/reparent/waypoints)
- Serializes to IV XML + UI XML

`src/editor/DeploymentViewDocument.ts`:

- Owns `dv`, `ui`, `boards`, plus derived deployment candidates
- Loads DV/UI, ensures layout entries, loads boards file
- Applies DV mutations (nodes/devices/connections, deploy/undeploy functions/messages)
- Serializes to DV XML + UI XML

## 4) Data Model and File Formats

Shared types: `src/model/types.ts`.

Key models:

- Interface side: `IvModel`, `FunctionModel`, `InterfaceModel`, `ConnectionModel`
- Deployment side: `DvModel`, node/device/connection/message types
- Shared layout: `UiModel`, `EntityLayout`
- Messaging protocol: `WebviewMessage`, `ExtensionMessage`, `DvWebviewMessage`, `DvExtensionMessage`
- User options: `EditorOptions`, `DEFAULT_OPTIONS`

XML parsing/serialization:

- Parsers: `src/parsers/*.ts` (`IvXmlParser`, `DvXmlParser`, `UiXmlParser`, `AttrXmlParser`, `BoardsXmlParser`)
- Serializers: `src/serializers/*.ts` (`IvXmlSerializer`, `DvXmlSerializer`, `UiXmlSerializer`)

Round-trip behavior is intentionally loss-tolerant for unknown attrs/properties through `extraAttrs` and preserved property lists.

## 5) Webview Architecture

Entry: `webview/src/main.tsx` chooses editor app via `document.body.dataset.editorKind`:

- Interface app: `webview/src/App.tsx`
- Deployment app: `webview/src/DvApp.tsx`

Canvas and interactions are implemented with React Flow (`@xyflow/react`), custom node/edge renderers, and per-editor local React state.

Core transformation layers:

- IV graph build: `webview/src/transform.ts`
- DV graph build: `webview/src/dvTransform.ts`

Image export pipelines:

- IV: `webview/src/exportImage.ts`
- DV: inline SVG/raster helpers in `webview/src/DvApp.tsx`

Message bridge:

- `webview/src/vscodeApi.ts` wraps `acquireVsCodeApi()` and typed `post(...)`

## 6) Primary Data Flows

### 6.1 Open / Initial Load

1. VS Code opens matching file with custom editor provider.
2. Provider creates document (`InterfaceViewDocument.create` or `DeploymentViewDocument.create`).
3. Document parses XML into typed models.
4. Webview loads and sends `ready`.
5. Provider replies with capabilities/options and `load` (IV) or `loadDv` (DV).
6. Webview builds graph nodes/edges and renders canvas.

### 6.2 Edit / Persisted Mutation

1. User action in webview emits typed message (e.g., `addFunction`, `updateDvNode`, `connect`).
2. Provider snapshots pre-state.
3. Document applies mutation to in-memory model.
4. Provider emits undo/redo closures and pushes refreshed diagram message.
5. Save writes XML (main model file + UI file).

### 6.3 Build / Run / CLI

1. User selects build action from context menu/palette.
2. Webview emits build message (`build*` for IV, `buildDv` for DV).
3. Provider resolves command:
   - direct `make ...`, or
   - wrapped via `scripts/taste-cli.sh` with `TASTE_DOCKER_IMAGE=...`
4. Command runs in shared terminal (`src/utils/terminal.ts`, terminal name `VSCive Commands`) with temporary `cd` into document directory.
5. `CLI` action opens interactive `taste-cli.sh` shell when wrapping is enabled.

### 6.4 Export Diagram as Image

1. Webview requests export target (`requestExport`).
2. Provider opens save dialog and returns chosen format.
3. Webview renders SVG/PNG data URL.
4. Provider writes exported bytes to selected file.

## 7) Coordinates and Layout Conventions

IV layout scale:

- `SC_SCALE = 0.05` in UI/graph transform path (`UiXmlParser`, `transform.ts`)

DV layout scale:

- `DV_LAYOUT_SCALE = 0.02` (`types.ts`, `DeploymentViewDocument`, `dvTransform.ts`)

IV function sizing in current code:

- Shared fallback defaults: `DEFAULT_FUNCTION_WIDTH = 270`, `DEFAULT_FUNCTION_HEIGHT = 190` (`types.ts`)
- New function creation default in document mutation path: `1780 x 960` (`InterfaceViewDocument.ts`)
- Interactive resize minimum in renderer: `200 x 100` (`webview/src/components/FunctionNode.tsx`)

## 8) Testing Coverage (Current)

Tests in `test/` cover parser/transform/export/editor behavior, including:

- attribute parsing (`attr-parser.test.ts`)
- interface/deployment editor behavior (`interfaceview.test.ts`, `deploymentview.test.ts`)
- graph transform and focus logic (`transform.test.ts`, `focus.test.ts`)
- image export (`export-image.test.ts`)
- interface node behavior (`interface-node.test.ts`)

## 9) Notable Design Characteristics

- Model authority is centralized in extension host documents.
- Message protocol is strongly typed across host/webview boundary.
- Undo/redo is snapshot-based (not operational transform/CRDT).
- XML round-trip prioritizes compatibility with existing TASTE/SpaceCreator artifacts.
- The extension implements both IV and DV editors with parallel architecture and shared options model.
