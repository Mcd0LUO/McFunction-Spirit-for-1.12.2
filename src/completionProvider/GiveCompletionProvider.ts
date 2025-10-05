import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

export class GiveCompletionProvider extends MinecraftCommandCompletionProvider {


    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {

        
        if (commands.length === 2) {
            // console.log(commands);
            return this.createSelectorArgumentsCompletion(commands[1], false);
        }
        if (commands.length === 3) {
            return this.createItemCompletion();
        }
        if (commands.length === 4) {
            return [this.createCompletionItem("<数量>", "count" , "1", true, vscode.CompletionItemKind.Value)];
        }
        if (commands.length === 5) {
            return [this.createCompletionItem("<数据值>", "data" , "0", true, vscode.CompletionItemKind.Value)];
        }

        return [];
    }


}