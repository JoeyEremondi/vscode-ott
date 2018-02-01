// src/extension.ts
import * as vscode from 'vscode';

import OttLintingProvider from './features/ottProvider';

export function activate(context: vscode.ExtensionContext) {
    let linter = new OttLintingProvider();
    linter.activate(context.subscriptions);
    vscode.languages.registerCodeActionsProvider('ott', linter);
}