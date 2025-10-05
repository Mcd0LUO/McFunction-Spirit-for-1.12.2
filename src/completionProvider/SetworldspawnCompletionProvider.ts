import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

export class SetworldspawnCompletionProvider extends MinecraftCommandCompletionProvider {


    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {

        return [];
        
    }

}