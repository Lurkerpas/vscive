import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseIvXml } from '../parsers/IvXmlParser';
import { parseUiXml } from '../parsers/UiXmlParser';
import { parseAttrXml, EMPTY_SCHEMA } from '../parsers/AttrXmlParser';
import { IvModel, UiModel, AttributeSchema } from '../model/types';

export class InterfaceViewDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    iv!: IvModel;
    ui!: UiModel;
    schema: AttributeSchema = EMPTY_SCHEMA;

    private constructor(uri: vscode.Uri) {
        this.uri = uri;
    }

    static async create(uri: vscode.Uri): Promise<InterfaceViewDocument> {
        const doc = new InterfaceViewDocument(uri);
        await doc.reload();
        await doc.loadSchema();
        return doc;
    }

    async reload(): Promise<void> {
        const xmlBytes = await vscode.workspace.fs.readFile(this.uri);
        const xmlStr = Buffer.from(xmlBytes).toString('utf8');
        this.iv = parseIvXml(xmlStr);

        const uiPath = path.join(path.dirname(this.uri.fsPath), this.iv.uiFile);
        try {
            const uiBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(uiPath));
            this.ui = parseUiXml(Buffer.from(uiBytes).toString('utf8'));
        } catch {
            this.ui = { version: '1.0', entities: {} };
        }
    }

    async loadSchema(): Promise<void> {
        const cfgPath = vscode.workspace.getConfiguration('vscive').get<string>('attributesFilePath')
            || path.join(process.env.HOME ?? '~', '.local', 'default_attributes.xml');
        try {
            const xml = fs.readFileSync(cfgPath, 'utf8');
            this.schema = parseAttrXml(xml);
        } catch {
            this.schema = EMPTY_SCHEMA;
        }
    }

    dispose(): void {
        // nothing to dispose for MVP
    }
}
