import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

export class FillCompletionProvider extends MinecraftCommandCompletionProvider {


    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        
        if (commands.length <= 7) {
            return this.createCoordinateCompletions();
        }
        if (commands.length === 8) {
            return this.createItemCompletion();
        }
        if (commands.length === 9) {
            return [this.createCompletionItem(
                "<数据值>",
                "data",
                "",
                true,
                vscode.CompletionItemKind.Value,

            )];
        }
        if (commands.length === 10) {
            //  destroy, hollow, keep, outline, replace
            return [this.createCompletionItem(
                "destroy",
                "摧毁原方块并填充",
                "destroy ",

                true,
                vscode.CompletionItemKind.Value,

            ), this.createCompletionItem(
                "hollow",
                "替换外层方块。内部替换为空气",
                "hollow ",

                true,
                vscode.CompletionItemKind.Value,

            ), this.createCompletionItem(
                "keep",
                "替换填充区域内的空气方块",
                "keep ",
                true,
                vscode.CompletionItemKind.Value,

            ), this.createCompletionItem(
                "outline",
                "填充区域外层的方块。内部方块不受影响",
                "outline ",
                true,
                vscode.CompletionItemKind.Value,

            ), this.createCompletionItem(
                "replace",
                "默认",
                "replace ",
                true,
                vscode.CompletionItemKind.Value,
            )

            ];
        }
        return [];
        
    }

}