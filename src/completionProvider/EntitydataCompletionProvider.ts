import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";
import { NBTUtils } from "../utils/NBTUtils";



export class EntitydataCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {

    switch (commands.length) {
            case 2:
                return this.createSelectorArgumentsCompletion(commands[1]);
            case 3:
                if (commands[2].startsWith("{")) {
                    return NBTUtils.provideEntityNBTCompletions(this.createCompletionItem);
                }
}


        return [];
    }
}