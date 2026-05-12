import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { DOMParser, XMLSerializer, Document as XmlDocument, Node as XmlNode } from '@xmldom/xmldom';

const thisDir = __dirname;

export const REPO_ROOT = path.resolve(thisDir, '..', '..');

export async function readUtf8(relativePath: string): Promise<string> {
    return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

export async function findRelativeFiles(rootRelativePath: string, fileName: string): Promise<string[]> {
    const rootAbsolutePath = path.join(REPO_ROOT, rootRelativePath);
    const matches: string[] = [];

    async function walk(dirPath: string): Promise<void> {
        const entries = await readdir(dirPath, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
                continue;
            }
            if (entry.isFile() && entry.name === fileName) {
                matches.push(path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/'));
            }
        }
    }

    await walk(rootAbsolutePath);
    return matches;
}

function stripWhitespaceOnlyText(node: XmlNode): void {
    const children: XmlNode[] = [];
    for (let index = 0; index < node.childNodes.length; index++) {
        const child = node.childNodes[index] as XmlNode | null;
        if (child) {
            children.push(child);
        }
    }
    for (const child of children) {
        if (child.nodeType === 3 && !/\S/u.test(child.nodeValue ?? '')) {
            node.removeChild(child);
            continue;
        }
        stripWhitespaceOnlyText(child);
    }
}

export function normalizeXml(xml: string): string {
    const document = new DOMParser().parseFromString(xml, 'text/xml');
    stripWhitespaceOnlyText(document);
    const root = document.documentElement;
    if (!root) {
        throw new Error('Missing XML root element');
    }
    return new XMLSerializer().serializeToString(root);
}

export function parseXmlDocument(xml: string): XmlDocument {
    const document = new DOMParser().parseFromString(xml, 'text/xml');
    if (!document.documentElement) {
        throw new Error('Missing XML root element');
    }
    return document;
}

export function decodeDataUrl(dataUrl: string): Buffer {
    const match = /^data:[^;]+;base64,(.+)$/u.exec(dataUrl);
    if (!match) {
        throw new Error(`Unsupported data URL: ${dataUrl.slice(0, 32)}`);
    }
    return Buffer.from(match[1], 'base64');
}