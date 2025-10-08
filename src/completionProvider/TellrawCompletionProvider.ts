import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from '../core/CommandCompletionProvider';
import { JsonCompletionHelper } from '../utils/JsonMessageComponentUtils';
/**
 * Tellraw命令补全提供者
 * 负责为Minecraft 1.12.2版本的/tellraw命令提供智能补全功能
 */
export class TellrawCompletionProvider extends MinecraftCommandCompletionProvider {
    /**
     * 提供tellraw命令的补全项入口方法
     * @param commands 已解析的命令参数数组
     * @param lineText 当前行文本
     * @param document 当前活动文档
     * @param position 光标位置
     * @returns 补全项数组
     */
    public provideCommandCompletions(
        commands: string[], 
        lineCommands: string[],
        document: vscode.TextDocument, 
        position: vscode.Position
    ): vscode.CompletionItem[] {
        // 补全目标选择器
        if (commands.length === 2) {
            return this.createSelectorArgumentsCompletion(commands[1], true);
        }
        
        // 补全JSON文本内容（使用工具类）
        if (commands.length >= 3) {
            // console.log(commands);
            return JsonCompletionHelper.provideJsonTextCompletions(this.extractCommand(document.lineAt(position.line).text.substring(0, position.character)),this.createCompletionItem.bind(this),document, position);
        }
        
        return [];
    }
}