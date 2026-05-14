// Shared model types — used by both extension host (parsers) and webview (rendering)

export interface PropertyModel {
    name: string;
    value: string;
}

export type ParameterEncoding = 'NATIVE' | 'ACN' | 'UPER';

export interface ParameterModel {
    name: string;
    /** ASN.1 type name */
    type: string;
    direction: 'input' | 'output';
    /** default: NATIVE; serialized as plain string in XML */
    encoding: ParameterEncoding;
}

export type InterfaceKind = 'Cyclic' | 'Sporadic' | 'Protected' | 'Unprotected';

export interface InterfaceModel {
    id: string;
    name: string;
    type: 'provided' | 'required';
    kind: InterfaceKind;
    parameters: ParameterModel[];
    /** Taste::InheritPI property */
    inheritPI: boolean;
    /** Whether Taste::InheritPI was explicitly present in source XML. */
    inheritPIExplicit?: boolean;
    /** Taste::Autonamed property */
    autonamed: boolean;
    /** Whether Taste::Autonamed was explicitly present in source XML. */
    autonamedExplicit?: boolean;
    /** All other <Property> children — round-trip */
    properties: PropertyModel[];
    /** All unknown XML attributes on the element — round-trip */
    extraAttrs: Record<string, string>;
}

export interface ImplementationModel {
    name: string;
    language: string;
}

export interface ContextParameterModel {
    name: string;
    type: string;
    value: string;
    extraAttrs: Record<string, string>;
}

export interface FunctionModel {
    id: string;
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
    contextParameters?: ContextParameterModel[];
    /** All <Property> children — round-trip */
    properties: PropertyModel[];
    /** All unknown XML attributes on the element — round-trip */
    extraAttrs: Record<string, string>;
}

export interface ConnectionModel {
    id: string;
    name: string;
    /** Whether the name attribute was explicitly present in source XML. */
    nameExplicit?: boolean;
    sourceIfaceId: string;
    /** Whether Source iface_id was explicitly present in source XML. */
    sourceIfaceIdExplicit?: boolean;
    sourceFuncName: string;
    sourceRiName: string;
    sourceNameAttr?: 'ri_name' | 'pi_name';
    targetIfaceId: string;
    /** Whether Target iface_id was explicitly present in source XML. */
    targetIfaceIdExplicit?: boolean;
    targetFuncName: string;
    targetPiName: string;
    targetNameAttr?: 'ri_name' | 'pi_name';
    properties: PropertyModel[];
    extraAttrs: Record<string, string>;
}

export interface CommentModel {
    id: string;
    name: string;
    requiredSystemElement: boolean;
    extraAttrs: Record<string, string>;
}

export interface LayerModel {
    name: string;
    isVisible: boolean;
}

export interface IvModel {
    version: string;
    asn1file: string;
    uiFile: string;
    modifierHash: string;
    functions: FunctionModel[];
    connections: ConnectionModel[];
    comments: CommentModel[];
    layers: LayerModel[];
    /** All unknown XML attributes on <InterfaceView> — round-trip */
    unknownXmlAttrs: Record<string, string>;
}

// ── UI / layout model ──────────────────────────────────────────────────────

export interface EntityLayout {
    /** Function: [x1,y1,x2,y2]; Interface: [x,y]; Connection: [x1,y1,...xn,yn] */
    coordinates: number[];
    /**
     * Modern UI XML only. Present on container functions that have nested children.
     * Stores the absolute canvas extent [x1,y1,x2,y2] of the expanded view.
     * Children's `coordinates` are absolute within this space.
     * When absent (leaf functions, interfaces, legacy format) children use `coordinates` directly.
     */
    rootCoordinates?: number[];
}

export interface UiModel {
    version: string;
    entities: Record<string, EntityLayout>;
}

export const DEFAULT_FUNCTION_WIDTH = 270;
export const DEFAULT_FUNCTION_HEIGHT = 190;

// ── Attribute schema ───────────────────────────────────────────────────────

export type EntityScope = 'Function' | 'Provided_Interface' | 'Required_Interface' | 'ProvidedInterface' | 'RequiredInterface';

export interface AttrValidator {
    name: string;
    value: string;
}

export interface EnumerationType {
    kind: 'enumeration';
    defaultValue: string;
    entries: string[];
}

export interface StringType {
    kind: 'string';
    defaultValue?: string;
    validator?: string;
}

export interface AttrDef {
    label: string;
    name: string;
    visible: boolean;
    scopes: EntityScope[];
    /** Validator conditions keyed by scope. Empty array = always shown in that scope. */
    scopeValidators: Partial<Record<EntityScope, AttrValidator[]>>;
    type: EnumerationType | StringType;
}

export interface AttributeSchema {
    attrs: AttrDef[];
}

// ── Editor options (persisted in extension globalState) ──────────────────

export interface EditorOptions {
    canvasColor: string;
    snapEnabled: boolean;
    snapGridSize: number;
    showMinimap: boolean;
    showInterfaceNames: boolean;
    showConnectionLabels: boolean;
    fontSizeFn: number;
    fontSizeIface: number;
    fontSizeConn: number;
    attrFilePath: string;
    useTasteCliShForCommands: boolean;
    /** Maximum number of undo steps retained per document. */
    undoDepth: number;
}

export const DEFAULT_OPTIONS: EditorOptions = {
    canvasColor: '#1e1e2e',
    snapEnabled: false,
    snapGridSize: 20,
    showMinimap: true,
    showInterfaceNames: true,
    showConnectionLabels: true,
    fontSizeFn: 90,
    fontSizeIface: 45,
    fontSizeConn: 11,
    attrFilePath: '',
    useTasteCliShForCommands: false,
    undoDepth: 100,
};

// ── postMessage protocol ───────────────────────────────────────────────────

export interface DiagramData {
    iv: IvModel;
    ui: UiModel;
    schema: AttributeSchema;
}

export interface ExtensionCapabilities {
    canBuild: boolean;
    canBuildSkeletons: boolean;
    canBrowseAttrFile: boolean;
    canEditFunction: boolean;
}

export type ExtensionMessage =
    | { type: 'load'; data: DiagramData }
    | { type: 'options'; options: EditorOptions }
    | { type: 'capabilities'; capabilities: ExtensionCapabilities }
    | { type: 'requestExport'; format: 'png' | 'svg' };

/** A single node-move record sent from the webview after drag-stop. */
export interface NodeMove {
    id: string;
    kind: 'function' | 'interface';
    /** RF position: absolute for root functions, relative-to-parent for nested functions and interfaces. */
    x: number;
    y: number;
    w: number;
    h: number;
    /** Parent function id — present for nested functions and all interface nodes. */
    parentId?: string;
}

export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'requestExport' }
    | { type: 'nodesMoved'; moves: NodeMove[] }
    | { type: 'addFunction'; id: string; name: string; language: string; rfX: number; rfY: number; parentId?: string }
    | { type: 'addInterface'; id: string; funcId: string; name: string; kind: InterfaceKind; ifaceType: 'provided' | 'required'; relRfX: number; relRfY: number }
    | { type: 'connect'; id: string; sourceIfaceId: string; targetIfaceId: string }
    | { type: 'delete'; ids: string[] }
    | { type: 'updateFunction'; id: string; name?: string; language?: string; defaultImplementation?: string; isType?: boolean; fixedSystemElement?: boolean; contextParameters?: ContextParameterModel[]; properties?: PropertyModel[]; extraAttrs?: Record<string, string> }
    | { type: 'updateInterface'; id: string; name?: string; kind?: InterfaceKind; inheritPI?: boolean; parameters?: ParameterModel[]; extraAttrs?: Record<string, string> }
    | { type: 'buildSkeletons' }
    | { type: 'build' }
    | { type: 'runDebug' }
    | { type: 'runRelease' }
    | { type: 'editFunction'; id: string }
    | { type: 'connectFunctions'; riId: string; piId: string; riFuncId: string; piFuncId: string; riRelX: number; riRelY: number; piRelX: number; piRelY: number }
    | { type: 'connectToFunction'; id: string; connId: string; existingIfaceId: string; targetFuncId: string; relRfX: number; relRfY: number }
    | { type: 'updateOptions'; options: EditorOptions }
    | { type: 'browseAttrFile' }
    | { type: 'exportImage'; format: 'png' | 'svg'; dataUrl: string }
    | { type: 'pasteFunction'; newId: string; source: FunctionModel; rfX: number; rfY: number }
    | { type: 'pasteInterface'; newId: string; source: InterfaceModel; funcId: string; relRfX: number; relRfY: number }
    | { type: 'reparentFunction'; id: string; newParentId?: string }
    | { type: 'updateConnectionWaypoints'; id: string; waypoints: Array<{x: number; y: number}> };
