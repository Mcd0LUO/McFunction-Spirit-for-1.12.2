import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

/**
 * Setblock命令补全提供者
 * 负责为Minecraft 1.12.2版本的/setblock命令提供智能补全功能
 * 
 * 命令语法：
 * /setblock <x> <y> <z> <block> [dataValue] [oldBlockHandling] [dataTag]
 * 
 * 参数说明：
 * - x, y, z: 方块坐标
 * - block: 方块ID
 * - dataValue: 方块数据值（可选）
 * - oldBlockHandling: 原方块处理方式（可选），包括：
 *   - destroy: 破坏原方块（有掉落物和特效）
 *   - keep: 仅在原位置为空气时放置方块
 *   - replace: 替换原方块（默认，无特效和掉落物）
 * - dataTag: 方块的NBT标签（可选）
 */
export class SetblockCompletionProvider extends MinecraftCommandCompletionProvider {


    /**
     * 提供setblock命令的补全项
     * @param commands 已解析的命令片段数组
     * @returns 补全项数组
     */
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        switch (commands.length) {
            case 2:
            case 3:
            case 4:
                // 处理坐标参数的自动补全
                return this.createCoordinateCompletions(true);
                
            case 5:
                // 处理方块ID参数的自动补全
                return this.createBlockCompletion();
                
            case 6:
                // 处理方块数据值参数的自动补全
                return [
                    this.createCompletionItem(
                        '<dataValue>', 
                        '方块数据值（0-15）', 
                        '', 
                        true, 
                        vscode.CompletionItemKind.Value
                    )
                ];
                
            case 7:
                // 处理原方块处理方式参数的自动补全
                return [
                    this.createCompletionItem(
                        'destroy', 
                        '破坏原方块（有掉落物和特效）', 
                        'destroy' + MinecraftCommandCompletionProvider.global_sufiix, 
                        true, 
                        vscode.CompletionItemKind.Keyword
                    ),
                    this.createCompletionItem(
                        'keep', 
                        '仅在原位置为空气时放置方块', 
                        'keep' + MinecraftCommandCompletionProvider.global_sufiix, 
                        true, 
                        vscode.CompletionItemKind.Keyword
                    ),
                    this.createCompletionItem(
                        'replace', 
                        '替换原方块（默认，无特效和掉落物）', 
                        'replace' + MinecraftCommandCompletionProvider.global_sufiix, 
                        true, 
                        vscode.CompletionItemKind.Keyword
                    )
                ];
                
                
            default:
                return [];
        }
    }
}