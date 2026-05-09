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
    /** Taste::Autonamed property */
    autonamed: boolean;
    /** All other <Property> children — round-trip */
    properties: PropertyModel[];
    /** All unknown XML attributes on the element — round-trip */
    extraAttrs: Record<string, string>;
}

export interface ImplementationModel {
    name: string;
    language: string;
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
    /** All <Property> children — round-trip */
    properties: PropertyModel[];
    /** All unknown XML attributes on the element — round-trip */
    extraAttrs: Record<string, string>;
}

export interface ConnectionModel {
    id: string;
    name: string;
    sourceIfaceId: string;
    sourceFuncName: string;
    sourceRiName: string;
    targetIfaceId: string;
    targetFuncName: string;
    targetPiName: string;
    properties: PropertyModel[];
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
    layers: LayerModel[];
    /** All unknown XML attributes on <InterfaceView> — round-trip */
    unknownXmlAttrs: Record<string, string>;
}

// ── UI / layout model ──────────────────────────────────────────────────────

export interface EntityLayout {
    /** Function: [x1,y1,x2,y2]; Interface: [x,y]; Connection: [x1,y1,...xn,yn] */
    coordinates: number[];
}

export interface UiModel {
    version: string;
    entities: Record<string, EntityLayout>;
}

// ── Attribute schema ───────────────────────────────────────────────────────

export type EntityScope = 'Function' | 'Provided_Interface' | 'Required_Interface' | 'ProvidedInterface' | 'RequiredInterface';

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
    type: EnumerationType | StringType;
}

export interface AttributeSchema {
    attrs: AttrDef[];
}

// ── postMessage protocol ───────────────────────────────────────────────────

export interface DiagramData {
    iv: IvModel;
    ui: UiModel;
    schema: AttributeSchema;
}

export type ExtensionMessage =
    | { type: 'load'; data: DiagramData };

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
    | { type: 'nodesMoved'; moves: NodeMove[] }
    | { type: 'addFunction'; id: string; name: string; language: string; rfX: number; rfY: number; parentId?: string }
    | { type: 'addInterface'; id: string; funcId: string; name: string; kind: InterfaceKind; ifaceType: 'provided' | 'required'; relRfX: number; relRfY: number }
    | { type: 'connect'; id: string; sourceIfaceId: string; targetIfaceId: string }
    | { type: 'delete'; ids: string[] }
    | { type: 'updateFunction'; id: string; name?: string; language?: string }
    | { type: 'updateInterface'; id: string; name?: string; kind?: InterfaceKind }
    | { type: 'buildSkeletons' }
    | { type: 'build' }
    | { type: 'editFunction'; id: string }
    | { type: 'connectFunctions'; riId: string; piId: string; riFuncId: string; piFuncId: string };
