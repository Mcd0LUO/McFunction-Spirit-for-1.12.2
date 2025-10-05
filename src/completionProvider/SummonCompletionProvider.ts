import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";
import { EntityNameList } from "../utils/EnumLib";
import { NBTUtils } from "../utils/NBTUtils";

export class SummonCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        
        let result: vscode.CompletionItem[] = [];
        if (commands.length === 2) {
            return this.createEntityNameCompletion(true);
        }

        if (commands.length >= 3 && commands.length <= 5) {
            return this.createCoordinateCompletions(true);
        }

        if (commands.length === 6) {
            if (commands[5] === '') {
                return this.createSingleCompletionItem('{}', 'NBT标签wrapper', '{${0:}}', false, vscode.CompletionItemKind.Snippet);
            }
            return NBTUtils.provideEntityNBTCompletions(this.createCompletionItem);
            }

        return [];
    }
}
