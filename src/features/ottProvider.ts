// Copied from https://github.com/hoovercj/vscode-extension-tutorial

'use strict';

import * as path from 'path';
import * as cp from 'child_process';
import ChildProcess = cp.ChildProcess;

import * as vscode from 'vscode';

/*
warning:
warning: warning:
error: (in checking and disambiguating quotiented syntax)
Parse error:
Ott version:
Definition rules:        18 good    0 bad
Definition rule clauses: 39 good    0 bad
Lexing error
no parses of ... lines \d+ - \d+
no parses (char \d+)
*/

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

        let magicCommentArgs = [];
        let firstLine = textDocument.getText().toString().split("\n")[0];
        let magicCommentMatch = firstLine.match(/%\s+!Ott\s+args\s*=\s*\"(.*)\"/i);
        if (magicCommentMatch != null) {
            console.log("Magic comment detected with arguments " + magicCommentMatch[1])
            magicCommentArgs = magicCommentArgs.concat(magicCommentMatch[1].split(/\s/i));
        }

        let args = [textDocument.fileName, "-colour=false"].concat(magicCommentArgs);

        let childProcess = cp.spawn('ott', args, options);
        if (childProcess.pid) {
            childProcess.stdout.on('data', (data: Buffer) => {
                stdoutData += data;
            });
            childProcess.stderr.on('data', (data: Buffer) => {
                stderrData += data;
            });
            let doMatches = diagnostics => item => {
                console.log("ITEM " + item + " .");
                let match = null;
                let range = new vscode.Range(0, 0, 0, 1);
                let severity = item.match(/(warning|no parse)/i) != null ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
                let message = "";

                if (match = item.match(/error:([\s\S]*) at file [\s\S]* line (\d+) char (\d+) - (\d+)/i)) {
                    message = match[1];
                    range = new vscode.Range(parseInt(match[2]) - 1, parseInt(match[3]),
                        parseInt(match[2]) - 1, parseInt(match[4]));
                    severity = vscode.DiagnosticSeverity.Error;
                }
                else if (match = item.match(/Lexing error\s*(.*)\s*file=[\S]*\s+line=(\d+)\s+char=(\d+)/i)) {
                    message = "Lexing error. (Maybe '}}}' is missing space in a tex hom?)";
                    if (parseInt(match[2]) - 1 < 1) {
                        range = new vscode.Range(parseInt(match[2]) - 1, parseInt(match[3]),
                            parseInt(match[2]) - 1, parseInt(match[3]));
                    }
                    severity = vscode.DiagnosticSeverity.Error
                }
                else if (match = item.match(/Parse error:\s*(.*)\s*file=[\S]*\s+line=(\d+)\s+char=(\d+)/i)) {
                    message = match[1];
                    if (parseInt(match[2]) - 1 < 1) {
                        range = new vscode.Range(parseInt(match[2]) - 1, parseInt(match[3]),
                            parseInt(match[2]) - 1, parseInt(match[3]));
                    }
                    severity = vscode.DiagnosticSeverity.Error
                }
                else if (match = item.match(/no parses of (.*) at file.*line\s*(\d+)\s*-\s*(\d+):.*no parses \(char (\d+)\):/i)) {
                    message = "Parse problem noticed here";
                    range = new vscode.Range(parseInt(match[2]) - 1, parseInt(match[4]),
                        parseInt(match[3]) - 1, 0);
                    diagnostics.push(new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Information));
                    message = "No parse for:" + match[5];
                    range = new vscode.Range(parseInt(match[2]) - 1, 0,
                        parseInt(match[2]) - 1, parseInt(match[4]));
                    severity = vscode.DiagnosticSeverity.Error
                }
                else if (match = item.match(/Fatal error: exception Failure\(\"(.*)\"\)/i)) {
                    message = "Fatal error, exception thrown: " + match[1];
                }
                //Catch-all for remaining errors and warnings 
                else if (match = item.match(/(warning|error):?(.*)/i)) {
                    message = match[2];
                }
                else {
                    return;
                }

                let diagnostic = new vscode.Diagnostic(range, message, severity);
                diagnostics.push(diagnostic);
            }
            let handleStream = (streamString: string) => () => {
                let stream = (streamString == "STDOUT" ? stdoutData : stderrData)
                //Replace annoying multi-line errors
                stream = stream.replace(/error:\s*(\(in checking and disambiguating quotiented syntax\))?\s*\n/i, "error: ")
                stream = stream.replace("\nno parses (", " -- no parses (")
                console.log("STREAM:\n" + stream)
                // console.log("STDOUT: " + stream);
                stream.split("\n").forEach(doMatches(diagnostics));
                this.diagnosticCollection.set(textDocument.uri, diagnostics);
            }
            childProcess.stdout.on('end', handleStream("STDOUT"));
            childProcess.stderr.on('end', handleStream("STDERR"));

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

