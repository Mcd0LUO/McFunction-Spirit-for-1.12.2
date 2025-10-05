import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

export class GamemodeCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        
        if (commands.length === 2) {
            return this.createSelectorArgumentsCompletion(commands[1], true, " ");
        }
        if (commands.length === 3) {
            return [
                this.createCompletionItem("survival", "生存模式","survival", false),
                this.createCompletionItem("creative", "创造模式","creative" ,false),
                this.createCompletionItem("adventure", "冒险模式","adventure",false),
                this.createCompletionItem("spectator", "旁观模式","spectator",false),
                this.createCompletionItem("0", "生存模式","0",false),
                this.createCompletionItem("1", "创造模式","1",false),
                this.createCompletionItem("2", "冒险模式","2",false),
                this.createCompletionItem("3", "旁观模式","3",false),

            ];
        }


        return [];
    }

}
