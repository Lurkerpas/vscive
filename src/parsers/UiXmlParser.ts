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

export function parseUiXml(xml: string): UiModel {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement;
    if (!root) { return { version: '1.0', entities: {} }; }
    const entities: Record<string, EntityLayout> = {};

    for (const entity of childElements(root, 'Entity')) {
        const id = entity.getAttribute('id') ?? '';
        const tastEl = childElements(entity, 'Taste')[0] as XmlElement | undefined;
        if (!tastEl) { continue; }
        const raw = tastEl.getAttribute('coordinates') ?? '';
        const coordinates = raw.trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
        entities[id] = { coordinates };
    }

    return { version: root.getAttribute('version') ?? '1.0', entities };
}

/** Scale factor: SpaceCreator units → React Flow pixels */
export const SC_SCALE = 0.05;

export function scCoordToPixel(v: number): number {
    return v * SC_SCALE;
}
