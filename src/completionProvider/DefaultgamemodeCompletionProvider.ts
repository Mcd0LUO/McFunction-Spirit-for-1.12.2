import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

/**
 * Defaultgamemode命令补全提供者
 * 负责为Minecraft 1.12.2版本的/defaultgamemode命令提供智能补全功能
 * 
 * 命令语法：
 * /defaultgamemode <mode>
 * 
 * 参数说明：
 * - mode: 默认游戏模式，可以是以下值之一：
 *   - survival 或 s 或 0：生存模式
 *   - creative 或 c 或 1：创造模式
 *   - adventure 或 a 或 2：冒险模式
 *   - spectator 或 sp 或 3：旁观者模式
 */
export class DefaultgamemodeCompletionProvider extends MinecraftCommandCompletionProvider {

    /**
     * 提供defaultgamemode命令的补全项
     * @param commands 已解析的命令片段数组
     * @param lineCommands 行内命令片段
     * @param document 当前文档
     * @param position 光标位置
     * @returns 补全项数组
     */
    public provideCommandCompletions(
        commands: string[],
        lineCommands: string[],
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        // defaultgamemode命令只需要一个参数：游戏模式
        if (commands.length === 2) {
            return [
                // 生存模式选项
                this.createCompletionItem(
                    'survival', 
                    '生存模式', 
                    'survival' + MinecraftCommandCompletionProvider.global_sufiix, 
                    false, 
                    vscode.CompletionItemKind.Enum
                ),
                this.createCompletionItem(
                    '0', 
                    '生存模式（数字ID）', 
                    '0' + MinecraftCommandCompletionProvider.global_sufiix, 
                    false, 
                    vscode.CompletionItemKind.Enum
                ),
                
                // 创造模式选项
                this.createCompletionItem(
                    'creative', 
                    '创造模式', 
                    'creative' + MinecraftCommandCompletionProvider.global_sufiix, 
                    false, 
                    vscode.CompletionItemKind.Enum
                ),

                this.createCompletionItem(
                    '1', 
                    '创造模式（数字ID）', 
                    '1' + MinecraftCommandCompletionProvider.global_sufiix, 
                    false, 
                    vscode.CompletionItemKind.Enum
                ),
                
                // 冒险模式选项
                this.createCompletionItem(
                    'adventure', 
                    '冒险模式', 
                    'adventure' + MinecraftCommandCompletionProvider.global_sufiix, 
                    false, 
                    vscode.CompletionItemKind.Enum
                ),

                this.createCompletionItem(
                    '2', 
                    '冒险模式（数字ID）', 
                    '2' + MinecraftCommandCompletionProvider.global_sufiix, 
                    false, 
                    vscode.CompletionItemKind.Enum
                ),
                
                // 旁观者模式选项
                this.createCompletionItem(
                    'spectator', 
                    '旁观者模式', 
                    'spectator' + MinecraftCommandCompletionProvider.global_sufiix, 
                    false, 
                    vscode.CompletionItemKind.Enum
                ),

                this.createCompletionItem(
                    '3', 
                    '旁观者模式（数字ID）', 
                    '3' + MinecraftCommandCompletionProvider.global_sufiix, 
                    false, 
                    vscode.CompletionItemKind.Enum
                )
            ];
        }
        
        return [];
    }
}