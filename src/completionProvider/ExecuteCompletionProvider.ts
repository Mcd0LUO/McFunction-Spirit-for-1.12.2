import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";
import * as vscode from "vscode";


export class ExecuteCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        
        // console.log(commands);
        if (commands.length === 2 && commands[1] === '') {
            return [
                this.createCompletionItem("@ ~ ~ ~", "Snippet", "@${1|a,e,s,p,r|} ${2:~} ${3:~} ${4:~}",true, vscode.CompletionItemKind.Snippet)
            ];
        }
        if (commands.length === 2) {
            return this.createSelectorArgumentsCompletion(commands[1], false);
        }

        return [];
    }


}