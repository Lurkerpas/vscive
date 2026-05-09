import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseIvXml } from '../parsers/IvXmlParser';
import { parseUiXml } from '../parsers/UiXmlParser';
import { parseAttrXml, EMPTY_SCHEMA } from '../parsers/AttrXmlParser';
import { IvModel, UiModel, AttributeSchema } from '../model/types';
import { log } from '../logger';

export class InterfaceViewDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    iv!: IvModel;
    ui!: UiModel;
    schema: AttributeSchema = EMPTY_SCHEMA;

    private constructor(uri: vscode.Uri) {
        this.uri = uri;
    }

    static async create(uri: vscode.Uri): Promise<InterfaceViewDocument> {
        log(`InterfaceViewDocument.create: ${uri.fsPath}`);
        const doc = new InterfaceViewDocument(uri);
        await doc.reload();
        await doc.loadSchema();
        log(`InterfaceViewDocument.create done: ${doc.iv.functions.length} fn, ${doc.iv.connections.length} conn`);
        return doc;
    }

    async reload(): Promise<void> {
        log(`reload: reading ${this.uri.fsPath}`);
        const xmlBytes = await vscode.workspace.fs.readFile(this.uri);
        const xmlStr = Buffer.from(xmlBytes).toString('utf8');
        log(`reload: parsing IV XML (${xmlStr.length} bytes)`);
        this.iv = parseIvXml(xmlStr);
        log(`reload: IV parsed — uiFile=${this.iv.uiFile}`);

        const uiPath = path.join(path.dirname(this.uri.fsPath), this.iv.uiFile);
        log(`reload: reading UI XML from ${uiPath}`);
        try {
            const uiBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(uiPath));
            this.ui = parseUiXml(Buffer.from(uiBytes).toString('utf8'));
            log(`reload: UI parsed — ${Object.keys(this.ui.entities).length} entities`);
        } catch (err) {
            log(`reload: UI XML not found or failed (${err}), using empty UI`);
            this.ui = { version: '1.0', entities: {} };
        }
    }

    async loadSchema(): Promise<void> {
        const cfgPath = vscode.workspace.getConfiguration('vscive').get<string>('attributesFilePath')
            || path.join(process.env.HOME ?? '~', '.local', 'default_attributes.xml');
        log(`loadSchema: trying ${cfgPath}`);
        try {
            const xml = fs.readFileSync(cfgPath, 'utf8');
            this.schema = parseAttrXml(xml);
            log('loadSchema: schema loaded');
        } catch (err) {
            log(`loadSchema: not found (${err}), using empty schema`);
            this.schema = EMPTY_SCHEMA;
        }
    }

    dispose(): void {
        // nothing to dispose for MVP
    }
}
