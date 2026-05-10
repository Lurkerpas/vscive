import { WebviewMessage } from '../../src/model/types';

declare const acquireVsCodeApi: () => { postMessage: (msg: unknown) => void };

let _api: ReturnType<typeof acquireVsCodeApi> | null = null;
try { _api = acquireVsCodeApi(); } catch { /* running outside VS Code */ }

export const vscodeApi = _api;

export function post(msg: WebviewMessage): void {
    _api?.postMessage(msg);
}
