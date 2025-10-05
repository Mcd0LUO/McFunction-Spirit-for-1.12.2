import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from '../core/CommandCompletionProvider';

export class KillCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        
        if (commands.length === 2) {
            return this.createSelectorArgumentsCompletion(commands[1],false);
        }
        return [];
    }
}