import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

export class XpCompletionProvider extends MinecraftCommandCompletionProvider { 

    /**
     * 提供xp命令的补全项
     * @param commands 已解析的命令片段数组
     * @returns 补全项数组
     */
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        switch (commands.length) {
            case 2:
                // 第二个参数是经验值数量，可以是数字或者带L后缀的等级
                return [
                    this.createCompletionItem(
                        '<amount>', 
                        '经验值数量（点数）', 
                        '', 
                        true, 
                        vscode.CompletionItemKind.Value
                    ),
                    this.createCompletionItem(
                        '<amount>L', 
                        '经验值数量（等级）', 
                        '${1:}L', 
                        true, 
                        vscode.CompletionItemKind.Value
                    )
                ];
            
            case 3:
                // 第三个参数是目标玩家
                return this.createSelectorArgumentsCompletion(commands[2], false);
                
            default:
                return [];
        }
    }
}