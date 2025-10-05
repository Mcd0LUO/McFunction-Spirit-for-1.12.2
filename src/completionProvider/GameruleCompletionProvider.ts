import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

/**
 * Gamerule命令补全提供者
 * 负责为Minecraft 1.12.2版本的/gamerule命令提供智能补全功能
 * 
 * 命令语法：
 * /gamerule <ruleName> [value]
 * 
 * 参数说明：
 * - ruleName: 游戏规则名称
 * - value: 规则值（可选，布尔值或整数）
 */
export class GameruleCompletionProvider extends MinecraftCommandCompletionProvider {

    /**
     * Minecraft 1.12.2版本支持的游戏规则列表
     * 包含规则名称、描述和值类型
     */
    private static readonly GAMERULES = [
        { name: 'announceAdvancements', desc: '是否在聊天框显示玩家进度', type: 'boolean' },
        { name: 'commandBlockOutput', desc: '是否广播命令方块输出', type: 'boolean' },
        { name: 'disableElytraMovementCheck', desc: '是否禁用鞘翅移动检测', type: 'boolean' },
        { name: 'doDaylightCycle', desc: '是否进行昼夜交替', type: 'boolean' },
        { name: 'doEntityDrops', desc: '控制Minecart等实体死亡是否掉落', type: 'boolean' },
        { name: 'doFireTick', desc: '是否允许火蔓延', type: 'boolean' },
        { name: 'doMobLoot', desc: '怪物死亡是否掉落物品', type: 'boolean' },
        { name: 'doMobSpawning', desc: '是否生成怪物', type: 'boolean' },
        { name: 'doTileDrops', desc: '方块破坏时是否掉落物品', type: 'boolean' },
        { name: 'doWeatherCycle', desc: '天气是否变化', type: 'boolean' },
        { name: 'keepInventory', desc: '玩家死亡是否保留物品栏', type: 'boolean' },
        { name: 'logAdminCommands', desc: '是否在日志中记录管理员命令', type: 'boolean' },
        { name: 'maxCommandChainLength', desc: '命令链最大长度', type: 'integer' },
        { name: 'maxEntityCramming', desc: '实体拥挤上限', type: 'integer' },
        { name: 'mobGriefing', desc: '怪物是否可以破坏方块', type: 'boolean' },
        { name: 'naturalRegeneration', desc: '玩家是否可以自然恢复生命值', type: 'boolean' },
        { name: 'randomTickSpeed', desc: '随机刻速率', type: 'integer' },
        { name: 'reducedDebugInfo', desc: '是否减少调试信息', type: 'boolean' },
        { name: 'sendCommandFeedback', desc: '是否发送命令反馈', type: 'boolean' },
        { name: 'showDeathMessages', desc: '是否显示死亡信息', type: 'boolean' },
        { name: 'spawnRadius', desc: '重生点半径', type: 'integer' },
        { name: 'spectatorsGenerateChunks', desc: '旁观者是否生成区块', type: 'boolean' }
    ];

    /**
     * 提供gamerule命令的补全项
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
                // 第二个参数是游戏规则名称
                return this.createGameruleCompletions();
            
            case 3:
                // 第三个参数是游戏规则的值
                const ruleName = commands[1];
                const rule = GameruleCompletionProvider.GAMERULES.find(r => r.name === ruleName);
                
                if (rule) {
                    if (rule.type === 'boolean') {
                        // 布尔值类型规则，提供true/false补全
                        return [
                            this.createCompletionItem(
                                'true', 
                                '开启', 
                                'true' + MinecraftCommandCompletionProvider.global_sufiix, 
                                false, 
                                vscode.CompletionItemKind.Value
                            ),
                            this.createCompletionItem(
                                'false', 
                                '关闭', 
                                'false' + MinecraftCommandCompletionProvider.global_sufiix, 
                                false, 
                                vscode.CompletionItemKind.Value
                            ),
                            this.createCompletionItem(
                                '1', 
                                '开启（数字形式）', 
                                '1' + MinecraftCommandCompletionProvider.global_sufiix, 
                                false, 
                                vscode.CompletionItemKind.Value
                            ),
                            this.createCompletionItem(
                                '0', 
                                '关闭（数字形式）', 
                                '0' + MinecraftCommandCompletionProvider.global_sufiix, 
                                false, 
                                vscode.CompletionItemKind.Value
                            )
                        ];
                    } else if (rule.type === 'integer') {
                        // 整数类型规则，提供数值输入提示
                        return [
                            this.createCompletionItem(
                                '<value>', 
                                '整数值', 
                                '', 
                                true, 
                                vscode.CompletionItemKind.Value
                            )
                        ];
                    }
                }
                
                // 如果找不到规则或规则类型未知，提供通用补全
                return [
                    this.createCompletionItem(
                        '<value>', 
                        '规则值（布尔值或整数）', 
                        '', 
                        true, 
                        vscode.CompletionItemKind.Value
                    )
                ];
                
            default:
                return [];
        }
    }

    /**
     * 创建游戏规则名称补全项
     * @returns 游戏规则补全项数组
     */
    private createGameruleCompletions(): vscode.CompletionItem[] {
        return GameruleCompletionProvider.GAMERULES.map(rule =>
            this.createCompletionItem(
                rule.name, 
                `${rule.desc} (${rule.type})`, 
                rule.name + MinecraftCommandCompletionProvider.global_sufiix, 
                true, 
                vscode.CompletionItemKind.Enum
            )
        );
    }
}