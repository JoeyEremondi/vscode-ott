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

        let stdoutData = ''
        let stderrData = ''
        let diagnostics: vscode.Diagnostic[] = [];

        let options = vscode.workspace.rootPath ? { cwd: vscode.workspace.rootPath } : undefined;

        let childProcess = cp.spawn('ott', [textDocument.fileName], options);
        if (childProcess.pid) {
            childProcess.stdout.on('data', (data: Buffer) => {
                stdoutData += data;
            });
            childProcess.stderr.on('data', (data: Buffer) => {
                stderrData += data;
            });
            let doMatches = diagnostics => item => {
                let severity = item.startsWith("warning") ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
                let re1 = /((warning|error): )?(.*) at file (.*) line (\d+) char (\d+) - (\d+)/i;
                let re2 = /Parse error:.*line=([\-]?\d+)\s*char=([\-]?\d+)/i;
                let re3 = /.*(warning|error):.*file.*line^[\d]*(\d+)^[\d]*char^[\d]*(\d+)^[\d]*/i;
                let match1 = item.match(re1);
                let match2 = item.match(re2);
                let match3 = item.match(re3);
                if (match1 != null) {
                    let message = match1[3];
                    let range = new vscode.Range(parseInt(match1[5]) - 1, parseInt(match1[6]),
                        parseInt(match1[5]) - 1, parseInt(match1[7]));
                    let diagnostic = new vscode.Diagnostic(range, message, severity);
                    diagnostics.push(diagnostic);
                } else if (match2 != null) {
                    console.log("match2")
                    let message = "Syntax error";
                    let range = null;
                    if (parseInt(match2[1]) - 1 < 1) {
                        range = new vscode.Range(0, 0, 0, 1);
                    } else {
                    range = new vscode.Range(parseInt(match2[1]) - 1, parseInt(match2[2]),
                        parseInt(match2[1]) - 1, parseInt(match2[2]) + 1);
                    }
                    
                    let diagnostic = new vscode.Diagnostic(range, message, severity);
                    diagnostics.push(diagnostic);
                } else if (match3 != null) {
                    console.log("match2")
                    let message = item;
                    let range = new vscode.Range(parseInt(match2[2]) - 1, parseInt(match2[3]),
                        parseInt(match2[2]) - 1, parseInt(match2[3]) + 1);
                    let diagnostic = new vscode.Diagnostic(range, message, severity);
                    diagnostics.push(diagnostic);
                }
            }
            childProcess.stdout.on('end', () => {
                console.log(stdoutData);
                stdoutData.split("\n").forEach(doMatches(diagnostics));
                this.diagnosticCollection.set(textDocument.uri, diagnostics);
            });
            childProcess.stderr.on('end', () => {
                // console.log(decoded);
                stderrData.split("\n").forEach(doMatches(diagnostics));
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

