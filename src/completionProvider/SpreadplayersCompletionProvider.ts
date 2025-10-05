import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

/**
 * Spreadplayers命令补全提供者
 * 负责为Minecraft 1.12.2版本的/spreadplayers命令提供智能补全功能
 * 
 * 命令语法：
 * /spreadplayers <x> <z> <spreadDistance> <maxRange> [respectTeams] <targets>
 * 
 * 参数说明：
 * - x, z: 扩散中心点坐标
 * - spreadDistance: 实体之间的最小距离
 * - maxRange: 从中心点开始的最大范围
 * - respectTeams: 是否考虑队伍（true/false，可选，默认为false）
 * - targets: 目标实体（玩家或实体选择器）
 */
export class SpreadplayersCompletionProvider extends MinecraftCommandCompletionProvider {


    /**
     * 提供spreadplayers命令的补全项
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
        switch (commands.length) {
            case 2:
                // 第二个参数是中心点的x坐标
                return this.createCoordinateCompletions();
            
            case 3:
                // 第三个参数是中心点的z坐标
                return this.createCoordinateCompletions();
                
            case 4:
                // 第四个参数是最小扩散距离
                return [
                    this.createCompletionItem(
                        '<spreadDistance>', 
                        '实体之间的最小距离', 
                        '', 
                        true, 
                        vscode.CompletionItemKind.Value
                    )
                ];
                
            case 5:
                // 第五个参数是最大扩散范围
                return [
                    this.createCompletionItem(
                        '<maxRange>', 
                        '从中心点开始的最大范围', 
                        '', 
                        true, 
                        vscode.CompletionItemKind.Value
                    )
                ];
                
            case 6:
                // 第六个参数是是否考虑队伍（true/false）
                return [
                    this.createCompletionItem(
                        'true', 
                        '考虑队伍（保持队伍在一起）', 
                        'true ', 
                        true, 
                        vscode.CompletionItemKind.Keyword
                    ),
                    this.createCompletionItem(
                        'false', 
                        '不考虑队伍（单独移动每个实体）', 
                        'false ', 
                        true, 
                        vscode.CompletionItemKind.Keyword
                    )
                ];
                
            case 7:
                // 第七个参数是目标实体（玩家或实体选择器）
                return this.createSelectorArgumentsCompletion(commands[6], true);
        }
        
        return [];
    }
}