// Copied from https://github.com/hoovercj/vscode-extension-tutorial

'use strict';

import * as path from 'path';
import * as cp from 'child_process';
import ChildProcess = cp.ChildProcess;

import * as vscode from 'vscode';

export class OttLintingProvider {

    private diagnosticCollection: vscode.DiagnosticCollection;

    private doHlint(textDocument: vscode.TextDocument) {
        if (textDocument.languageId !== 'ott') {
            return;
        }

        let decoded = ''
        let diagnostics: vscode.Diagnostic[] = [];

        let options = vscode.workspace.rootPath ? { cwd: vscode.workspace.rootPath } : undefined;

        let childProcess = cp.spawn('ott', [textDocument.fileName], options);
        if (childProcess.pid) {
            childProcess.stdout.on('data', (data: Buffer) => {
                decoded += data;
            });
            childProcess.stdout.on('end', () => {
                // console.log(decoded);
                decoded.split("\n").forEach(item => {
                    let severity = item.startsWith("warning") ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
                    let re = /((warning|error): )?(.*) at file (.*) line (\d+) char (\d+) - (\d+)/i;
                    let match = item.match(re);
                    if (match != null) {
                        let message = match[3];
                        let range = new vscode.Range(parseInt(match[5]) - 1, parseInt(match[6]),
                            parseInt(match[5]) - 1, parseInt(match[7]));
                        let diagnostic = new vscode.Diagnostic(range, message, severity);
                        diagnostics.push(diagnostic);
                    }
                });
                this.diagnosticCollection.set(textDocument.uri, diagnostics);
            });
        }
    }

    private static commandId: string = 'haskell.hlint.runCodeAction';

    public provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.Command[] {
        let diagnostic: vscode.Diagnostic = context.diagnostics[0];
        return [{
            title: "Accept hlint suggestion",
            command: OttLintingProvider.commandId,
            arguments: [document, diagnostic.range, diagnostic.message]
        }];
    }

    private runCodeAction(document: vscode.TextDocument, range: vscode.Range, message: string): any {
        let fromRegex: RegExp = /.*Replace:(.*)==>.*/g
        let fromMatch: RegExpExecArray = fromRegex.exec(message.replace(/\s/g, ''));
        let from = fromMatch[1];
        let to: string = document.getText(range).replace(/\s/g, '')
        if (from === to) {
            let newText = /.*==>\s(.*)/g.exec(message)[1]
            let edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, range, newText);
            return vscode.workspace.applyEdit(edit);
        } else {
            vscode.window.showErrorMessage("The suggestion was not applied because it is out of date. You might have tried to apply the same edit twice.");
        }
    }

    // src/features/hlintProvider.ts
    private command: vscode.Disposable;

    public activate(subscriptions: vscode.Disposable[]) {
        this.command = vscode.commands.registerCommand(OttLintingProvider.commandId, this.runCodeAction, this);
        subscriptions.push(this);
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection();

        vscode.workspace.onDidOpenTextDocument(this.doHlint, this, subscriptions);
        vscode.workspace.onDidCloseTextDocument((textDocument) => {
            this.diagnosticCollection.delete(textDocument.uri);
        }, null, subscriptions);

        vscode.workspace.onDidSaveTextDocument(this.doHlint, this);

        // Hlint all open haskell documents
        vscode.workspace.textDocuments.forEach(this.doHlint, this);
    }

    public dispose(): void {
        this.diagnosticCollection.clear();
        this.diagnosticCollection.dispose();
        this.command.dispose();
    }
}

interface METAVARDEFN { kind: "metavardefn"; lhs: string; rhs: string; }
interface RULES { kind: "rules" }
interface DEFNCLASS { kind: "defnclass" }
interface FUNDEFNCLASS { kind: "fundefnclass" }
interface SUBRULES { kind: "subrules" }
interface CONTEXTRULES { kind: "contextrules" }
interface SUBSTITUTIONS { kind: "substitutions" }
interface FREEVARS { kind: "freevars" }
interface EMBED { kind: "embed" }
interface PARSING { kind: "parsing" }
interface HOMS { kind: "homs" }
interface COQSECTIONBEGIN { kind: "coqsectionbegin" }
interface COQSECTIONEND { kind: "coqsectionend" }
interface COQVARIABLE { kind: "coqvariable" }
interface GENERICITEM { kind: "genericitem", data: string }

type Item = METAVARDEFN
    | RULES
    | DEFNCLASS
    | FUNDEFNCLASS
    | SUBRULES
    | CONTEXTRULES
    | SUBSTITUTIONS
    | FREEVARS
    | EMBED
    | PARSING
    | HOMS
    | COQSECTIONBEGIN
    | COQSECTIONEND
    | COQVARIABLE
    | GENERICITEM;

export class OttFormatter {
    public static ottFormatter: vscode.DocumentFormattingEditProvider = {
        provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {

            console.log("Parse data:")
            OttFormatter.parseItems(document.getText().toString());

            const firstLine = document.lineAt(0);
            if (firstLine.text !== '%42') {
                return [vscode.TextEdit.insert(firstLine.range.start, '%42\n')];
            }
        }
    }

    private static parseItems(document: string): Item[] {

        let tagsString = "grammar|metavar|indexvar|embed|subrules|substitutions|freevars|defns";
        let tags = tagsString.split("|");
        let initialComments = [];
        let tagsRE = new RegExp(`(${tagsString})`);
        let items = document.split(tagsRE);
        // console.log(items);
        if (tags.indexOf(items[0]) <= -1) {
            initialComments.push(items.shift());
        }
        let pairs = [];
        //Iterate through every  tag-item pair
        var i = 0;
        for (i = 0; i < items.length; i += 2) {
            pairs.push([items[i], items[i + 1]]);
        }
        let result = pairs.map(this.parseItem);
        console.log(result);
        return null;
    }

    private static parseItem(pair: [string, string]): Item {
        let [tag, rest] = pair;
        let str = tag + rest;
        switch (tag) {

            case "metavar":
            case "indexvar":
                let parts = str.split(/((indexvar|metavar)\s*([a-zA-z_]+)(\s*,\s*[a-zA-z_]+)*\s*::=)/i);
                let rhs = parts.pop();
                let lhs = parts.join("");
                return { kind: "metavardefn", lhs: parts[1], rhs: rhs };

            default:
                return { kind: "genericitem", data: str };
        }
    }


}
