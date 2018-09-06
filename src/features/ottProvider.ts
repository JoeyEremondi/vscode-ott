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

enum OutputType {
    Coq,
    Tex,
    Other
}

class OttConfig {
    outputs: [OutputType, string][] = [];
    flags: string[] = [];
    options: [string, string][] = [];
    checkOutputs: boolean = true;
    ottCommand: string = "ott";
    foundError: boolean = false;
}

export class OttLintingProvider {

    logPanel: vscode.OutputChannel;
    config: OttConfig;
    debug: boolean = false;

    private diagnosticCollection: vscode.DiagnosticCollection;

    public constructor() {
        this.logPanel = vscode.window.createOutputChannel('Ott Output');
        this.logPanel.appendLine("Ott Language Extension Started");
        this.config = new OttConfig();
        this.config.ottCommand = vscode.workspace.getConfiguration('ott').get('ott_command');
    }

    private logMessage(s: string) {
        this.logPanel.appendLine(s);
    }

    private debugMessage(s: string) {
        if (this.debug) {
            console.log(s);
        }
    }

    private parseLoc(line: string): vscode.Range[] {
        var ranges: vscode.Range[] = [];
        let match;
        line.split(";").forEach(locString => {
            if (match = locString.match(/(File [\s\S]* )?on line (\d+), column (\d+) - (\d+).*/i)) {
                this.debugMessage("match 1 " + match);
                let range = new vscode.Range(parseInt(match[2]) - 1, parseInt(match[3]),
                    parseInt(match[2]) - 1, parseInt(match[4]));
                ranges.push(range);
            } else if (match = locString.match(/(File [\s\S]* )?on line (\d+), column (\d+) - line (\d+), column (\d+).*/i)) {
                this.debugMessage("match 2 " + match);
                ranges.push(new vscode.Range(parseInt(match[2]) - 1, parseInt(match[3]),
                    parseInt(match[4]) - 1, parseInt(match[5])));
            } else if (match = locString.match(/(File [\s\S]* )?on line (\d+) - (\d+).*/i)) {
                this.debugMessage("match 3 " + match);
                ranges.push(new vscode.Range(parseInt(match[2]) - 1, parseInt(match[0]),
                    parseInt(match[3]) - 1, parseInt(match[0])));
            }
        });
        return ranges;
    }

    private getMessages(stream: string) {
        this.debugMessage("In Get Messages, stream " + stream);
        var ret = [];
        let toProcess = stream.split("\n").reverse();
        this.debugMessage("Lines: " + toProcess);
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
            if (current.startsWith("Ott version") || current.startsWith("Definition") || current.length < 1) {
                this.debugMessage("Skipping version/defn line " + current);
                continue;
            } else if (this.parseLoc(current).length > 0) {
                this.debugMessage("Storing loc line " + current);
                storeGroup();
                //Add this line and the next to our group, since we know 
                //The next line is Error or Warning
                currentGroup.push(current);
                current = toProcess.pop();
                this.debugMessage("After loc storing line " + current);
                currentGroup.push(current);
                continue;
            } else if (current.startsWith("Error:") || current.startsWith("Warning:")) {
                this.debugMessage("Storing error start line " + current);
                storeGroup();
                currentGroup.push(current);
            } else {
                this.debugMessage("Storing extra line " + current);
                currentGroup.push(current);
            }

        }
        storeGroup();
        return ret;
    }

    private doMatches = diagnostics => (item: string) => {
        this.debugMessage("ITEM " + item);
        let match = null;
        let ranges = [new vscode.Range(0, 0, 0, 1)];

        let lineArr = item.split("\n");
        // if (lineArr.length > 1) {
        let firstLine = lineArr[0];
        let maybeLoc = this.parseLoc(firstLine);
        if (maybeLoc.length > 0) {
            ranges = maybeLoc;
            lineArr.splice(0, 1);
            let rest = lineArr.join(" \n");
            this.debugMessage("Setting REST to " + rest);
            item = rest;
            // }
        }
        // else {
        //     this.debugMessage("Only one line in the item");
        // }

        let severity = null;
        if (item.startsWith("Warning:")) {
            severity = vscode.DiagnosticSeverity.Warning;
            item = item.replace(/^(Warning:\.)/, "")
        } else if (item.startsWith("Error:")) {
            severity = vscode.DiagnosticSeverity.Error;
            this.config.foundError = true;
            item = item.replace(/^(Error:\.)/, "")
        } else {
            this.debugMessage("Invalid error level: " + item);
            return;
        }


        ranges.forEach(range => {
            let diagnostic = new vscode.Diagnostic(range, item, severity);
            diagnostics.push(diagnostic);
        });

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

        let magicCommentRE = /%\s+!Ott(.*)\n/g;
        let docString = textDocument.getText().toString();
        let match = magicCommentRE.exec(docString);
        console.log("Looking for comment " + match);
        while (match != null) {
            console.log("Found comment " + match);
            let commentValue = match[1];
            let range = textDocument.getWordRangeAtPosition(new vscode.Position(match.index, match.index + match.length));
            if (true) {
                let match = null;
                if (match = commentValue.match(/\s*debug\s*/)) {
                    this.logMessage("Turing debugging on ");
                    this.debug = true;
                } else if (match = commentValue.match(/\s*output\s*(\S*)\s*/)) {
                    let outFileName = match[1];
                    let parts = outFileName.split(".");
                    let ext = parts[parts.length - 1];
                    this.logMessage("Magic comment arguments output: " + outFileName);
                    let outputType: OutputType;
                    switch (ext) {
                        case "v":
                            outputType = OutputType.Coq;
                            break;
                        case "tex":
                            outputType = OutputType.Tex;
                            break;
                        default:
                            outputType = OutputType.Other;
                            break;
                    }
                    this.config.outputs.push([outputType, outFileName]);
                } else if (match = commentValue.match(/\s*flag\s*(\S*)\s*/)) {
                    this.logMessage("Magic comment flag detected: " + match[1]);
                    this.config.flags.push(match[1]);
                }
                else if (match = commentValue.match(/\s*option\s*(\S*)\s*=\s*(\S*)/)) {
                    this.logMessage("Magic comment option detected: " + match[1] + " " + match[2]);
                    this.config.options.push([match[1], match[2]]);
                }
                else if (match = commentValue.match(/\s*commandPath\s*(\S*) \s*/)) {
                    this.logMessage("Magic comment command path detected: " + match[1]);
                    this.config.ottCommand = match[1];
                }
                else {
                    this.logMessage("Invalid magic comment: " + commentValue);
                    let diagnostic = new vscode.Diagnostic(range, "Invalid magic comment: " + commentValue, vscode.DiagnosticSeverity.Warning);
                    diagnostics.push(diagnostic);
                }

            }
            match = magicCommentRE.exec(docString);
        }

        let args = ["-i", textDocument.fileName, "-colour", "false"];
        this.config.options.forEach(opt => {
            let [key, val] = opt;
            args.push("-" + key);
            args.push(val);
        });
        this.config.outputs.forEach(outFile => {
            args.push("-o");
            args.push(outFile[1]);
        });
        this.config.flags.forEach(flag => {
            args.push("-" + flag);
        });

        this.logMessage("running command: " + this.config.ottCommand + " " + args.join(" "));
        let childProcess = cp.spawn(this.config.ottCommand, args, options);
        if (childProcess.pid) {
            childProcess.stdout.on('data', (data: Buffer) => {
                stdoutData += data;
            });
            childProcess.stderr.on('data', (data: Buffer) => {
                stderrData += data;
            });



            let handleStream = (streamString: string) => () => {
                let stream = (streamString == "STDOUT" ? stdoutData : stderrData)
                this.logMessage("Ott output from " + stream);
                this.logMessage(stdoutData);

                let messages = this.getMessages(stream);
                this.debugMessage("Got messages: " + messages);
                messages.forEach(this.doMatches(diagnostics));
                //Finally, add all our diagnostics
                this.diagnosticCollection.set(textDocument.uri, diagnostics);

            }



            //If stdout is done, run postprocessor command

            childProcess.stdout.on('end', handleStream("STDOUT"));
            childProcess.stderr.on('end', handleStream("STDERR"));
            //Run any post-processors from magic comments once ott has finished running
            childProcess.on('exit', () => {
                if (this.config.checkOutputs && !this.config.foundError) {
                    try {
                        this.config.outputs.forEach(outPair => {
                            let [fileType, outFile] = outPair;
                            switch (fileType) {
                                case OutputType.Coq:
                                    this.logMessage("Trying to check for valid coq on " + outFile)
                                    let options = vscode.workspace.rootPath ? { cwd: vscode.workspace.rootPath } : undefined;
                                    let coqMessages = ""
                                    let coqProcess = cp.spawn("coqc", [outFile], options);
                                    if (coqProcess.pid) {
                                        coqProcess.stderr.on('data', (data: Buffer) => {
                                            coqMessages += data;
                                        });
                                        coqProcess.stdout.on('data', (data: Buffer) => {
                                            coqMessages += data;
                                        });
                                    }
                                    coqProcess.stderr.on('end', () => {
                                        this.logMessage("Got coq stderr " + coqMessages);
                                        let messages = this.getMessages(coqMessages);
                                        messages.forEach(this.doMatches(diagnostics));
                                        //Finally, add all our diagnostics
                                        this.diagnosticCollection.set(textDocument.uri, diagnostics);
                                    }
                                    );
                                    break;
                                default:
                                    break;
                            }

                        });
                    } catch (e) { this.logMessage("Failed validating output files: " + e) }
                }
            });


        }


    }

    // private static commandId: string = 'ott.hlint.runCodeAction';

    public provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.Command[] {
        let diagnostic: vscode.Diagnostic = context.diagnostics[0];
        return [
            //     {
            //     title: "Accept hlint suggestion",
            //     command: OttLintingProvider.commandId,
            //     arguments: [document, diagnostic.range, diagnostic.message]
            // }
        ];
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
    // private command: vscode.Disposable;

    public activate(subscriptions: vscode.Disposable[]) {

        // this.command = vscode.commands.registerCommand(OttLintingProvider.commandId, this.runCodeAction, this);
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
        // this.command.dispose();
    }
}

