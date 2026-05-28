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

function rewriteFirstLine(text: string, rewrite: (line: string) => string): string {
    const lines = text.trim().split('\n');
    if (lines.length === 0) {
        return '';
    }
    lines[0] = rewrite(lines[0]);
    return lines.join('\n').trim();
}

export function formatSdlDisplayText(kind: SdlSymbolKind, text: string): string {
    if (kind === 'textArea') {
        return text
            .split('\n')
            .filter(line => !/^\s*\/\*\s*CIF\b/.test(line))
            .join('\n')
            .trim();
    }

    switch (kind) {
        case 'start':
            return 'START';
        case 'state':
            return rewriteFirstLine(text, line => line.replace(/^\s*state\b\s*/i, ''));
        case 'stateAggregation':
            return rewriteFirstLine(text, line => line.replace(/^\s*state\s+aggregation\b\s*/i, ''));
        case 'input':
            return rewriteFirstLine(text, line => line.replace(/^\s*input\b\s*/i, ''));
        case 'continuousSignal':
            return rewriteFirstLine(text, line => line.replace(/^\s*provided\b\s*/i, ''));
        case 'output':
            return rewriteFirstLine(text, line => line.replace(/^\s*output\b\s*/i, ''));
        case 'task':
            return rewriteFirstLine(text, line => line.replace(/^\s*task\b\s*/i, ''));
        case 'decision':
            return rewriteFirstLine(text, line => line.replace(/^\s*decision\b\s*/i, ''));
        case 'alternative':
            return rewriteFirstLine(text, line => line.replace(/^\s*alternative\b\s*/i, ''));
        case 'procedure':
            return rewriteFirstLine(text, line => line.replace(/^\s*procedure\b\s*/i, ''));
        case 'procedureCall':
            return rewriteFirstLine(text, line => line.replace(/^\s*call\b\s*/i, ''));
        case 'nextstate':
            return rewriteFirstLine(text, line => line.replace(/^\s*nextstate\b\s*/i, ''));
        case 'return':
            return rewriteFirstLine(text, line => line.replace(/^\s*return\b\s*/i, ''));
        case 'join':
            return rewriteFirstLine(text, line => line.replace(/^\s*join\b\s*/i, ''));
        case 'connect':
            return rewriteFirstLine(text, line => line.replace(/^\s*connect\b\s*/i, ''));
        case 'label':
            return rewriteFirstLine(text, line => line.replace(/^\s*connection\b\s*/i, ''));
        default:
            return text.trim();
    }

}

export function shouldLeftAlignSdlText(kind: SdlSymbolKind): boolean {
    return LEFT_ALIGNED_KINDS.has(kind);
}