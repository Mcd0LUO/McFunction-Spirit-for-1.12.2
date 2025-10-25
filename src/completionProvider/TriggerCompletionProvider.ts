import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";
import { DataLoader } from "../core/DataLoader";
import { FileLineIdleSearchProcessor } from "../core/FileLineIdleSearchProcessor";

export class TriggerCompletionProvider extends MinecraftCommandCompletionProvider {


    public provideCommandCompletions(
        commands: string[],
        lineCommands: string[],
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        switch (commands.length) {
            case 2:
                // 第二个参数是trigger的计分板目标名称（必须是trigger类型的计分板）
                return this.createTriggerObjectiveCompletion(commands[1], document, position);
            
            case 3:
                // 第三个参数是操作类型：add 或 set
                return [
                    this.createCompletionItem('add', '增加数值到计分板目标', 'add ', true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('set', '设置计分板目标的数值', 'set ', true, vscode.CompletionItemKind.Keyword)
                ];
            
            case 4:
                // 第四个参数是数值
                return [
                    this.createCompletionItem('<value>', '要增加或设置的数值', '', true, vscode.CompletionItemKind.Value)
                ];
        }
        
        return [];
    }

    /**
     * 创建trigger目标补全项
     * @param currentInput 当前输入
     * @param document 当前文档
     * @param position 光标位置
     * @returns 补全项数组
     */
    private createTriggerObjectiveCompletion(
        currentInput: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const scoreboardNames: Map<string, [string, string, vscode.Uri, number]> = FileLineIdleSearchProcessor.SCOREBOARDS;
        if (!scoreboardNames) {
            return [];
        }
        // 计算当前输入的文本范围
        const wordRange = this.getWordRange(document, position, currentInput.length);
        return Array.from(scoreboardNames.entries()).filter(([key, value]) => value[0] === 'trigger').map(([key, value]) =>
            this.createCompletionItem(key, value[1], key + MinecraftCommandCompletionProvider.global_sufiix, true, vscode.CompletionItemKind.Value, wordRange)
        );
    }
}
