import * as vscode from 'vscode';
import { preferBracedId } from './id';

const SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function decodeUtf8(bytes: Uint8Array): string {
    return textDecoder.decode(bytes);
}

export function encodeUtf8(text: string): Uint8Array {
    return textEncoder.encode(text);
}

export async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
    const response = await fetch(dataUrl);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
}

export function createUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return preferBracedId(crypto.randomUUID());
    }

    return preferBracedId('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const random = Math.floor(Math.random() * 16);
        const value = char === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    }));
}

export function dirnameUri(uri: vscode.Uri): vscode.Uri {
    const trimmed = uri.path.replace(/\/+$/, '');
    const lastSlash = trimmed.lastIndexOf('/');
    const dirPath = lastSlash <= 0 ? '/' : trimmed.slice(0, lastSlash);
    return uri.with({ path: dirPath });
}

export function joinPathSegments(base: vscode.Uri, ...segments: string[]): vscode.Uri {
    const normalized = segments.flatMap(segment => segment.split('/').filter(Boolean));
    return normalized.length > 0 ? vscode.Uri.joinPath(base, ...normalized) : base;
}

export function basename(value: string | vscode.Uri): string {
    const source = typeof value === 'string' ? value : value.path;
    const trimmed = source.replace(/\/+$/, '');
    const lastSlash = trimmed.lastIndexOf('/');
    return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}

export function extname(value: string | vscode.Uri): string {
    const name = basename(value);
    const lastDot = name.lastIndexOf('.');
    return lastDot > 0 ? name.slice(lastDot) : '';
}

export function basenameWithoutExtension(value: string | vscode.Uri): string {
    const name = basename(value);
    const suffix = extname(name);
    return suffix ? name.slice(0, -suffix.length) : name;
}

export function serializeUriForSetting(uri: vscode.Uri): string {
    return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

export function parseStoredUriOrPath(value: string | undefined): vscode.Uri | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }

    return SCHEME_PREFIX.test(trimmed) ? vscode.Uri.parse(trimmed, true) : vscode.Uri.file(trimmed);
}

export function displayUri(uri: vscode.Uri): string {
    return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}