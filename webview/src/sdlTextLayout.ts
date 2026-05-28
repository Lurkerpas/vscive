import { SdlSymbolKind } from '../../src/model/types';

const LEFT_ALIGNED_KINDS = new Set<SdlSymbolKind>([
    'textArea',
    'task',
    'output',
    'procedureCall',
    'input',
    'continuousSignal',
    'comment',
    'label',
]);

export function formatSdlDisplayText(kind: SdlSymbolKind, text: string): string {
    if (kind === 'textArea') {
        return text
            .split('\n')
            .filter(line => !/^\s*\/\*\s*CIF\b/.test(line))
            .join('\n')
            .trim();
    }

    return text;
}

export function shouldLeftAlignSdlText(kind: SdlSymbolKind): boolean {
    return LEFT_ALIGNED_KINDS.has(kind);
}