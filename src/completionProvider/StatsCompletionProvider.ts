import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from '../core/CommandCompletionProvider';
import { DataLoader } from "../core/DataLoader";
import { FileLineIdleSearchProcessor } from '../core/FileLineIdleSearchProcessor';


const STATAS_OPTIONS = [
    { name: 'entity', desc: '影响实体' },
    { name: 'block', desc: '影响方块' },
];
const OPERATION_OPTIONS = [
    { name: 'clear', desc: '解绑' },
    { name: 'set', desc: '设置' },
];

const TYPE_OPTIONS = [
    { name: 'AffectedBlocks', desc: '影响方块' },
    { name: 'AffectedEntities', desc: '影响实体' },
    { name: 'AffectedItems', desc: '影响物品' },
    { name: 'QueryResult', desc: '查询结果' },
    { name: 'SuccessCount', desc: '成功数' },
];

export class StatsCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[], lineCommands: string[], document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        switch (commands.length) {
            case 2:
                return STATAS_OPTIONS.map(option => {
                    return this.createCompletionItem(
                        option.name,
                        option.desc,
                        option.name + MinecraftCommandCompletionProvider.global_sufiix,
                        true,
                        vscode.CompletionItemKind.TypeParameter
                    );
                });
            case 3:
                if (commands[1] === "entity") {
                    return this.createSelectorArgumentsCompletion(commands[2],true);
                }
                if (commands[1] === "block") {
                    return this.createCoordinateCompletions(true);
                }
                return [];
            case 4:
                if (commands[1] === "entity") {
                    return OPERATION_OPTIONS.map(option =>
                        this.createCompletionItem(
                            option.name,
                            option.desc,
                            option.name + MinecraftCommandCompletionProvider.global_sufiix,
                            true,
                            vscode.CompletionItemKind.Keyword
                        )
                    );
                }
                return [];
            case 5:
                if (commands[1] === "entity") {
                    return TYPE_OPTIONS.map(option =>
                        this.createCompletionItem(
                            option.name,
                            option.desc,
                            option.name + MinecraftCommandCompletionProvider.global_sufiix,
                            true,
                            vscode.CompletionItemKind.Keyword
                        )
                    );
                }
                return [];
            case 6:
                if (commands[1] === 'entity') {
                    return this.createSelectorArgumentsCompletion(commands[5],true);
                }
                if (commands[1] === 'block') {
                    return OPERATION_OPTIONS.map(option =>
                        this.createCompletionItem(
                            option.name,
                            option.desc,
                            option.name + MinecraftCommandCompletionProvider.global_sufiix,
                            true,
                            vscode.CompletionItemKind.Keyword
                        )
                    );
                }
                return [];
            case 7:
                if (commands[1] === 'entity') {
                    // 修复：传入所需参数
                    const inputLength = commands[6] ? commands[6].length : 0;
                    return this.createScoreboardNameCompletion(document, position, inputLength, true);
                }
                if (commands[1] === "block") {
                    return TYPE_OPTIONS.map(type => {
                        return this.createCompletionItem(
                            type.name, 
                            "", 
                            type.name + MinecraftCommandCompletionProvider.global_sufiix, 
                            true, 
                            vscode.CompletionItemKind.Enum
                        );
                    });
                }
                return [];
            case 8:
                if (commands[1] === "block") {
                    return this.createSelectorArgumentsCompletion(commands[7],true);
                }
                // 注意：这里缺少break语句，控制流会继续到case 9。如果这是有意为之，请保留；否则应添加break。
            case 9:
                if (commands[1] === "block") {
                    // 获取计分板数据，类型为Map<string, [string, string]>
                    const scoreboards = FileLineIdleSearchProcessor.SCOREBOARDS;

                    // 将Map转换为数组并创建补全项
                    return Array.from(scoreboards.entries()).map(([name, [type, displayName]]) => {
                        return this.createCompletionItem(
                            name, 
                            `类型:${type} 注释: ${displayName}`, 
                            name + " ", 
                            false, 
                            vscode.CompletionItemKind.Enum
                        );
                    });
                }
        }
        return [];
    }
}