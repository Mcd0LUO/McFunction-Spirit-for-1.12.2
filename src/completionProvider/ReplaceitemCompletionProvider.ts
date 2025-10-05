import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

/**
 * Replaceitem命令补全提供者
 * 负责为Minecraft 1.12.2版本的/replaceitem命令提供智能补全功能
 * 
 * 命令语法：
 * 1. 替换实体物品：
 * /replaceitem entity <targets> <slot> <item> [count] [data] [dataTag]
 * 
 * 2. 替换方块物品（容器）：
 * /replaceitem block <x> <y> <z> <slot> <item> [count] [data] [dataTag]
 * 
 * 参数说明：
 * - targets: 目标实体（玩家或实体选择器）
 * - x, y, z: 方块坐标
 * - slot: 槽位名称
 * - item: 物品ID
 * - count: 物品数量（可选）
 * - data: 物品数据值（可选）
 * - dataTag: 物品NBT标签（可选）
 */
export class ReplaceitemCompletionProvider extends MinecraftCommandCompletionProvider {


    /**
     * 提供replaceitem命令的补全项
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
                // 第二个参数是操作类型：entity 或 block
                return [
                    this.createCompletionItem(
                        'entity', 
                        '操作实体', 
                        'entity ', 
                        true, 
                        vscode.CompletionItemKind.Keyword
                    ),
                    this.createCompletionItem(
                        'block', 
                        '操作方块', 
                        'block ', 
                        true, 
                        vscode.CompletionItemKind.Keyword
                    )
                ];
            
            case 3:
                // 根据操作类型提供不同的补全
                if (commands[1] === 'entity') {
                    // 第三个参数是目标实体（玩家或实体选择器）
                    return this.createSelectorArgumentsCompletion(commands[2], true);
                } else if (commands[1] === 'block') {
                    // 第三个参数是方块的x坐标
                    return this.createCoordinateCompletions();
                }
                break;
                
            case 4:
                // 根据操作类型提供不同的补全
                if (commands[1] === 'entity') {
                    // 第四个参数是实体的槽位
                    return this.createEntitySlotCompletion();
                } else if (commands[1] === 'block') {
                    // 第四个参数是方块的y坐标
                    return this.createCoordinateCompletions();
                }
                break;
                
            case 5:
                // 根据操作类型提供不同的补全
                if (commands[1] === 'entity') {
                    // 第五个参数是物品ID
                    return this.createItemCompletion();
                } else if (commands[1] === 'block') {
                    // 第五个参数是方块的z坐标
                    return this.createCoordinateCompletions();
                }
                break;
                
            case 6:
                // 根据操作类型提供不同的补全
                if (commands[1] === 'entity') {
                    // 第六个参数是物品数量（可选）
                    return [
                        this.createCompletionItem(
                            '<count>', 
                            '物品数量', 
                            '', 
                            true, 
                            vscode.CompletionItemKind.Value
                        )
                    ];
                } else if (commands[1] === 'block') {
                    // 第六个参数是方块的槽位
                    return this.createBlockSlotCompletion();
                }
                break;
                
            case 7:
                // 根据操作类型提供不同的补全
                if (commands[1] === 'entity') {
                    // 第七个参数是物品数据值（可选）
                    return [
                        this.createCompletionItem(
                            '<data>', 
                            '物品数据值', 
                            '', 
                            true, 
                            vscode.CompletionItemKind.Value
                        )
                    ];
                } else if (commands[1] === 'block') {
                    // 第七个参数是物品ID
                    return this.createItemCompletion();
                }
                break;
                
            case 8:
                // 根据操作类型提供不同的补全
                if (commands[1] === 'entity') {
                    // 第八个参数是物品NBT标签（可选）
                    return [
                        this.createCompletionItem(
                            '<dataTag>', 
                            '物品NBT标签', 
                            '', 
                            true, 
                            vscode.CompletionItemKind.Value
                        )
                    ];
                } else if (commands[1] === 'block') {
                    // 第八个参数是物品数量（可选）
                    return [
                        this.createCompletionItem(
                            '<count>', 
                            '物品数量', 
                            '', 
                            true, 
                            vscode.CompletionItemKind.Value
                        )
                    ];
                }
                break;
                
            case 9:
                // block操作的第九个参数是物品数据值（可选）
                if (commands[1] === 'block') {
                    return [
                        this.createCompletionItem(
                            '<data>', 
                            '物品数据值', 
                            '', 
                            true, 
                            vscode.CompletionItemKind.Value
                        )
                    ];
                }
                break;
                
            case 10:
                // block操作的第十个参数是物品NBT标签（可选）
                if (commands[1] === 'block') {
                    return [
                        this.createCompletionItem(
                            '<dataTag>', 
                            '物品NBT标签', 
                            '', 
                            true, 
                            vscode.CompletionItemKind.Value
                        )
                    ];
                }
                break;
        }
        
        return [];
    }

    /**
     * 创建实体槽位补全项
     * @returns 实体槽位补全项数组
     */
    private createEntitySlotCompletion(): vscode.CompletionItem[] {
        const slots = [
            { name: 'slot.armor.chest', desc: '胸甲槽位' },
            { name: 'slot.armor.feet', desc: '靴子槽位' },
            { name: 'slot.armor.head', desc: '头盔槽位' },
            { name: 'slot.armor.legs', desc: '护腿槽位' },
            { name: 'slot.weapon.mainhand', desc: '主手槽位' },
            { name: 'slot.weapon.offhand', desc: '副手槽位' },
            { name: 'slot.container.<number>', desc: '容器槽位（0-53）' },
            { name: 'slot.enderchest.<number>', desc: '末影箱槽位（0-26）' },
            { name: 'slot.hotbar.<number>', desc: '快捷栏槽位（0-8）' },
            { name: 'slot.inventory.<number>', desc: '背包槽位（0-26）' }
        ];
        
        return slots.map(slot => 
            this.createCompletionItem(
                slot.name, 
                slot.desc, 
                slot.name + ' ', 
                true, 
                vscode.CompletionItemKind.Field
            )
        );
    }

    /**
     * 创建方块槽位补全项
     * @returns 方块槽位补全项数组
     */
    private createBlockSlotCompletion(): vscode.CompletionItem[] {
        const slots = [
            { name: 'slot.container.<number>', desc: '容器槽位（0-53）' },
            { name: 'slot.enderchest.<number>', desc: '末影箱槽位（0-26）' }
        ];
        
        return slots.map(slot => 
            this.createCompletionItem(
                slot.name, 
                slot.desc, 
                slot.name + ' ', 
                true, 
                vscode.CompletionItemKind.Field
            )
        );
    }
}