import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

export class SpawnpointCompletionProvider extends MinecraftCommandCompletionProvider {


    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        if (commands.length === 2) {
            return this.createSelectorArgumentsCompletion(commands[1], true);
        }
        if (commands.length >= 3 && commands.length <= 5) {
            return this.createCoordinateCompletions();
        }
        return [];
        
    }

}