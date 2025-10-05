import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";
import { ItemNameMap } from "../utils/EnumLib";


export class ClearCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {

        
        if (commands.length === 2) {
            return this.createSelectorArgumentsCompletion(commands[1], false);
        }
        if (commands.length === 3) {
            const completionItems: vscode.CompletionItem[] = [];
            for (const [item, name] of Object.entries(ItemNameMap.all)) {

                completionItems.push(this.createCompletionItem(item, name, item + ' ', true, vscode.CompletionItemKind.Class));
            }
            return completionItems;

        }


        return [];
    }
}