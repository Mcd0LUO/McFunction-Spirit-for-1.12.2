import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from '../core/CommandCompletionProvider';

export class TpCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        
        let items: vscode.CompletionItem[] = [];
        if (commands.length === 2) {
            items = this.createSelectorArgumentsCompletion(commands[1],false);
        }
        if (commands.length === 3) {
            this.createSelectorArgumentsCompletion(commands[2]).forEach(element => {
                items.push(element);
            });
            items.push(this.createCompletionItem('<x> <y> <z>',"绝对坐标","${1:x} ${2:y} ${3:z}",false));
            items.push(this.createCompletionItem('~<x> ~<y> ~<z>',"相对坐标","~${1:x} ~${2:y} ~${3:z}",false));

        }
        

        return items;
}
}