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

    logPanel: vscode.OutputChannel;

    private diagnosticCollection: vscode.DiagnosticCollection;

    public constructor() {
        this.logPanel = vscode.window.createOutputChannel('Ott Output');
        this.logPanel.appendLine("Ott Language Extension Started")
    }

    private logMessage(s: string) {
        this.logPanel.appendLine(s);
    }

    private doHlint(textDocument: vscode.TextDocument) {
        this.logMessage("\n\n\n********************************************************")
        if (textDocument.languageId !== 'ott') {
            return;
        }

        let stdoutData = ''
        let stderrData = ''
        let diagnostics: vscode.Diagnostic[] = [];

        let options = vscode.workspace.rootPath ? { cwd: vscode.workspace.rootPath } : undefined;

        let magicCommentArgs = [];
        let postProcessors = [];

        let magicCommentRE = /%\s+!Ott\s+(args|postprocess)\s*=\s*\"(.*)\"\s*\n/g;
        let docString = textDocument.getText().toString();
        let match = magicCommentRE.exec(docString);
        while (match != null) {
            switch (match[1]) {
                case "args":
                    this.logMessage("Magic comment arguments detected: " + match[2]);
                    magicCommentArgs = magicCommentArgs.concat(match[2].split(/\s/i));
                    break;
                case "postprocess":
                    this.logMessage("Magic comment postprocessor detected: " + match[2]);
                    postProcessors.push(match[2]);
                    break;
                default:
                    break;
            }
            match = magicCommentRE.exec(docString);

        }

        let args = [textDocument.fileName, "-colour=false"].concat(magicCommentArgs);

        this.logMessage("running command: ott " + args.join(" "));
        let childProcess = cp.spawn('ott', args, options);
        if (childProcess.pid) {
            childProcess.stdout.on('data', (data: Buffer) => {
                stdoutData += data;
            });
            childProcess.stderr.on('data', (data: Buffer) => {
                stderrData += data;
            });
            let doMatches = diagnostics => item => {
                console.log("ITEM " + item);
                let match = null;
                let range = new vscode.Range(0, 0, 0, 1);
                let severity = item.match(/(warning)/i) != null ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
                let message = "";

                if (match = item.match(/(warning|error):([\s\S]*) at file [\s\S]* line (\d+) char (\d+) - (\d+)/i)) {
                    message = match[2];
                    range = new vscode.Range(parseInt(match[3]) - 1, parseInt(match[4]),
                        parseInt(match[3]) - 1, parseInt(match[5]));
                }
                else if (match = item.match(/Lexing error\s*(.*)\s*file=[\S]*\s+line=(\d+)\s+char=(\d+)/i)) {
                    // console.log("Lexing error match!!!!")
                    message = "Lexing error. (Maybe '}}}' is missing space in a tex hom?)";
                    if (parseInt(match[2]) - 1 >= 1) {
                        range = new vscode.Range(parseInt(match[2]) - 1, parseInt(match[3]),
                            parseInt(match[2]) - 1, parseInt(match[3]));
                    }
                    severity = vscode.DiagnosticSeverity.Error
                }
                else if (match = item.match(/Parse error:\s*(.*)\s*file=[\S]*\s+line=(\d+)\s+char=(\d+)/i)) {
                    message = match[1];
                    if (parseInt(match[2]) - 1 >= 1) {
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
                    message = "No parse for:" + match[1];
                    range = new vscode.Range(parseInt(match[2]) - 1, 0,
                        parseInt(match[2]) - 1, parseInt(match[4]));
                    severity = vscode.DiagnosticSeverity.Error
                }
                else if (match = item.match(/multiple parses of (.*) at file.*line\s*(\d+)\s*-\s*(\d+):(.*)/i)) {
                    message = "Multiple parses for:" + match[1] + match[4].split("--").join("\n\nPossible parse: ");
                    range = new vscode.Range(parseInt(match[2]) - 1, 0,
                        parseInt(match[3]) - 1, 0);
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
                this.logMessage("Ott output from " + stream);
                this.logMessage(stdoutData);

                //Replace annoying multi-line errors
                stream = stream.replace(/error:\s*(\(in checking syntax\))?\s*\n/g, "error: ");
                stream = stream.replace(/error:\s*(\(in checking and disambiguating quotiented syntax\))?\s*\n/g, "error: ");
                stream = stream.replace(/\nno parses \(.*\)/g, " -- no parses (");
                stream = stream.replace(
                    /\n(.*)\n\s*or plain:(.*)/g,
                    (match, $1, $2, offset, original) => { return " -- " + $2; });
                stream = stream.replace(
                    /production\s*\n(.*)\n\s*of rule/g,
                    (match, $1, $2, offset, original) => { return " production " + $1 + " of rule"; });

                // console.log("STDOUT: " + stream);
                stream.split("\n").forEach(doMatches(diagnostics));
                this.diagnosticCollection.set(textDocument.uri, diagnostics);

            }



            //If stdout is done, run postprocessor command

            childProcess.stdout.on('end', handleStream("STDOUT"));
            childProcess.stderr.on('end', handleStream("STDERR"));
            //Run any post-processors from magic comments once ott has finished running
            childProcess.on('exit', () => {
                postProcessors.forEach(postProcessor => {
                    this.logMessage("Runing postprocessor: " + postProcessor);
                    let postProcessorProcess = cp.exec(postProcessor, options, (err, stdout, stderr) => {
                        this.logMessage("Postproceesor '" + postProcessor + "' Output:\n" + stdout);
                        if (stderr != "") {
                            this.logMessage("Postproceesor Errors:\n" + stderr);
                        }
                        if (err) {
                            this.logMessage("Postproceesor exited with error: " + err);
                        }
                    });

                });
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

