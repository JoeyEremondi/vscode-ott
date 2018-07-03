// Copied from https://github.com/hoovercj/vscode-extension-tutorial

'use strict';

import * as path from 'path';
import * as cp from 'child_process';
import ChildProcess = cp.ChildProcess;

import * as vscode from 'vscode';
import { WSAETOOMANYREFS } from 'constants';

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
    ottCommand: string;

    private diagnosticCollection: vscode.DiagnosticCollection;

    public constructor() {
        this.logPanel = vscode.window.createOutputChannel('Ott Output');
        this.logPanel.appendLine("Ott Language Extension Started");
        this.ottCommand = vscode.workspace.getConfiguration('ott').get('ott_command');
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

        let args = [textDocument.fileName, "-colour", "false"].concat(magicCommentArgs);

        this.logMessage("running command: " + this.ottCommand + " " + args.join(" "));
        let childProcess = cp.spawn(this.ottCommand, args, options);
        if (childProcess.pid) {
            childProcess.stdout.on('data', (data: Buffer) => {
                stdoutData += data;
            });
            childProcess.stderr.on('data', (data: Buffer) => {
                stderrData += data;
            });
            function parseLoc(line: string):vscode.Range[]  {
                var ranges : vscode.Range[] = [] ;
                let match;
                line.split(";").forEach(locString => {
                    if (match = locString.match(/(File [\s\S]* )?on line (\d+), column (\d+) - (\d+).*/i)) {
                        console.log("match 1 " + match);
                        let range = new vscode.Range(parseInt(match[2]) - 1, parseInt(match[3]),
                            parseInt(match[2]) - 1, parseInt(match[4]));
                        ranges.push(range);
                    } else if (match = locString.match(/(File [\s\S]* )?on line (\d+), column (\d+) - line (\d+), column (\d+).*/i)) {
                        console.log("match 2 " + match);
                        ranges.push(new vscode.Range(parseInt(match[2]) - 1, parseInt(match[3]),
                            parseInt(match[4]) - 1, parseInt(match[5])));
                    } else if (match = locString.match(/(File [\s\S]* )?on line (\d+) - (\d+).*/i)) {
                        console.log("match 3 " + match);
                        ranges.push(new vscode.Range(parseInt(match[2]) - 1, parseInt(match[0]),
                            parseInt(match[3]) - 1, parseInt(match[0])));
                    }
                });
                return ranges;
            }
            let getMessages = (stream: string) => {
                console.log("In Get Messages, stream " + stream);
                var ret = [];
                let toProcess = stream.split("\n").reverse();
                console.log("Lines: " + toProcess);
                var currentGroup = [];
                let storeGroup = () => {
                    if (currentGroup.length > 0) {
                        ret.push(currentGroup.join("\n"));
                        currentGroup = [];
                    }
                }
                while (toProcess.length > 0) {
                    let current = toProcess.pop();
                    current = current.trim();
                    if (current.startsWith("Ott version") || current.startsWith("Definition") || current.length < 1 ) {
                        console.log("Skipping version/defn line " + current);
                        continue;
                    } else if (parseLoc(current).length > 0) {
                        console.log("Storing loc line " + current);
                        storeGroup();
                        //Add this line and the next to our group, since we know 
                        //The next line is Error or Warning
                        currentGroup.push(current);
                        current = toProcess.pop();
                        console.log("After loc storing line " + current);
                        currentGroup.push(current);
                        continue;
                    } else if (current.startsWith("Error:") || current.startsWith("Warning:")) {
                        console.log("Storing error start line " + current);
                        storeGroup();
                        currentGroup.push(current);
                    } else {
                        console.log("Storing extra line " + current);
                        currentGroup.push(current);
                    }

                }
                storeGroup();
                return ret;
            }
            let doMatches = diagnostics => (item: string) => {
                console.log("ITEM " + item);
                let match = null;
                let ranges = [new vscode.Range(0, 0, 0, 1)];

                let lineArr = item.split("\n");
                // if (lineArr.length > 1) {
                let firstLine = lineArr[0];
                let maybeLoc = parseLoc(firstLine);
                if (maybeLoc.length > 0) {
                    ranges = maybeLoc;
                    lineArr.splice(0, 1);
                    let rest = lineArr.join(" \n");
                    console.log("Setting REST to " + rest);
                    item = rest;
                    // }
                } 
                // else {
                //     console.log("Only one line in the item");
                // }

                let severity = null;
                if (item.startsWith("Warning:")) {
                    severity = vscode.DiagnosticSeverity.Warning;
                    item = item.replace(/^(Warning:\.)/, "")
                } else if (item.startsWith("Error:")) {
                    severity = vscode.DiagnosticSeverity.Error;
                    item = item.replace(/^(Error:\.)/, "")
                } else {
                    console.log("Invalid error level: " + item);
                    return;
                }
                

                ranges.forEach(range => {
                    let diagnostic = new vscode.Diagnostic(range, item, severity);
                    diagnostics.push(diagnostic);
                });

            }
            let handleStream = (streamString: string) => () => {
                let stream = (streamString == "STDOUT" ? stdoutData : stderrData)
                this.logMessage("Ott output from " + stream);
                this.logMessage(stdoutData);

                let messages = getMessages(stream);
                console.log("Got messages: " + messages);
                messages.forEach(doMatches(diagnostics));

                //Replace annoying multi-line errors
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

