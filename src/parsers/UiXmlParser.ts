import { DOMParser, Element as XmlElement, Document as XmlDocument } from '@xmldom/xmldom';
import { UiModel, EntityLayout } from '../model/types';

function childElements(el: XmlElement | XmlDocument, tagName: string): XmlElement[] {
    const out: XmlElement[] = [];
    const nodes = el.childNodes;
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.nodeType === 1 && (n as XmlElement).tagName === tagName) {
            out.push(n as XmlElement);
        }
    }
    return out;
}

function normalizeEntityId(id: string): string {
    const trimmed = id.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.length > 2) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function isBraceWrappedId(id: string): boolean {
    const trimmed = id.trim();
    return trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.length > 2;
}

export function parseUiXml(xml: string): UiModel {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement;
    if (!root) { return { version: '1.0', entities: {} }; }
    const entityEntries = new Map<string, { key: string; isWrapped: boolean; layout: EntityLayout }>();

    for (const entity of childElements(root, 'Entity')) {
        const rawId = (entity.getAttribute('id') ?? '').trim();
        const id = normalizeEntityId(rawId);
        if (!id) { continue; }
        const tastEl = childElements(entity, 'Taste')[0] as XmlElement | undefined;
        if (!tastEl) { continue; }
        const raw = tastEl.getAttribute('coordinates') ?? '';
        const coordinates = raw.trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
        const rawRc = tastEl.getAttribute('RootCoordinates') ?? '';
        const rcNums = rawRc.trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
        const layout: EntityLayout = { coordinates };
        if (rcNums.length >= 2) { layout.rootCoordinates = rcNums; }
        const isWrapped = isBraceWrappedId(rawId);

        const existing = entityEntries.get(id);
        if (!existing || existing.isWrapped || !isWrapped) {
            entityEntries.set(id, { key: isWrapped ? rawId : id, isWrapped, layout });
        }
    }

    const entities: Record<string, EntityLayout> = {};
    for (const entry of entityEntries.values()) {
        entities[entry.key] = entry.layout;
    }

    return { version: root.getAttribute('version') ?? '1.0', entities };
}

/** Scale factor: SpaceCreator units → React Flow pixels */
export const SC_SCALE = 0.05;

export function scCoordToPixel(v: number): number {
    return v * SC_SCALE;
}
