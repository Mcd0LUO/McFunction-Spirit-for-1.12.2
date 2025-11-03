import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";
import { DataLoader } from "../core/DataLoader";
import * as vscode from "vscode";
import { ItemNameMap, MinecraftStats } from "../utils/EnumLib";
import { MinecraftStatsDetail } from "../utils/EnumLib";
import { FileLineIdleSearchProcessor } from "../core/FileLineIdleSearchProcessor";

// 常量定义 - 提取重复使用的命令和操作符
const PRIMARY_SUB_COMMANDS = [
    { name: 'objectives', desc: '管理计分板目标', insertText: 'objectives' },
    { name: 'players', desc: '管理玩家分数', insertText: 'players' },
    { name: 'teams', desc: '管理队伍', insertText: 'teams' }
];

const PLAYER_OPERATIONS = [
    { name: 'add', desc: '增加玩家分数', insertText: 'add' },
    { name: 'remove', desc: '减少玩家分数', insertText: 'remove' },
    { name: 'set', desc: '设置玩家分数', insertText: 'set' },
    { name: 'reset', desc: '重置玩家分数', insertText: 'reset' },
    { name: 'tag', desc: '管理玩家标签', insertText: 'tag', },
    { name: 'list', desc: '列出玩家分数', insertText: 'list', commitCharacter: false },
    { name: 'operation', desc: '分数运算', insertText: 'operation' },
    { name: 'enable', desc: '启用触发器', insertText: 'enable' }
];

const OPERATORS = [
    { name: '+=', desc: '加法运算', kind: vscode.CompletionItemKind.Operator, insertText: '+=' },
    { name: '-=', desc: '减法运算', kind: vscode.CompletionItemKind.Operator, insertText: '-=' },
    { name: '*=', desc: '乘法运算', kind: vscode.CompletionItemKind.Operator, insertText: '*=' },
    { name: '/=', desc: '除法运算', kind: vscode.CompletionItemKind.Operator, insertText: '/=' },
    { name: '%=', desc: '取模运算', kind: vscode.CompletionItemKind.Operator, insertText: '%=' },
    { name: '=', desc: '赋值', kind: vscode.CompletionItemKind.Operator, insertText: '= ' },
    { name: '<', desc: '取较小值', kind: vscode.CompletionItemKind.Operator, insertText: '<' },
    { name: '>', desc: '取较大值', kind: vscode.CompletionItemKind.Operator, insertText: '>' },
    { name: '><', desc: '交换分数', kind: vscode.CompletionItemKind.Operator, insertText: '><' }
];

const OBJECTIVE_OPERATIONS = [
    { name: 'add', desc: '添加新计分项', insertText: 'add' },
    { name: 'remove', desc: '删除计分项', insertText: 'remove', commitCharacter: true },
    { name: 'list', desc: '列出所有计分项', insertText: 'list', commitCharacter: false },
    { name: 'setdisplay', desc: '设置显示位置', insertText: 'setdisplay' }
];

const DISPLAY_POSITIONS = [
    { name: 'sidebar', desc: '侧边栏', kind: vscode.CompletionItemKind.Enum },
    { name: 'list', desc: 'tab列表', kind: vscode.CompletionItemKind.Enum },
    { name: 'belowName', desc: '名称下方', kind: vscode.CompletionItemKind.Enum }
];

const TAG_OPERATIONS = [
    { name: 'add', desc: '添加标签', insertText: 'add' },
    { name: 'remove', desc: '删除标签', insertText: 'remove' }
];

const DATA_OPTIONS = [
    { name: 'SelectedItem', desc: '玩家手持物品', insertText: '{SelectedItem:{${1:}}}', kind: vscode.CompletionItemKind.Variable },
    { name: 'SelectedItemSlot', desc: '玩家选择快捷栏槽位', insertText: '{SelectedItemSlot:{${1:}}}', kind: vscode.CompletionItemKind.Variable },
    { name: 'Inventory', desc: '玩家背包', insertText: '{Inventory:[{${1:}}]}', kind: vscode.CompletionItemKind.Variable },
    { name: '背包含tag物品', desc: '', insertText: '{Inventory:[{tag:{Tags:[${1:}]}}]}', kind: vscode.CompletionItemKind.Snippet },
    { name: '手持含tag物品', desc: '', insertText: '{SelectedItem:{tag:{Tags:[${1:}]}}}', kind: vscode.CompletionItemKind.Snippet }
];

/**
 * 计分板命令补全提供者
 * 处理Minecraft中scoreboard相关命令的自动补全逻辑
 */
export class ScoreboardCompletionProvider extends MinecraftCommandCompletionProvider {
    private keywordKind: vscode.CompletionItemKind = vscode.CompletionItemKind.Keyword;
    // 修复配置读取可能为undefined的问题
    private isScoreboardNameCompletion: boolean = !!((DataLoader.getConfig() ?? {})["ignore-function-directory"]);

    /**
     * 提供命令补全项
     * @param commands 已输入的命令片段数组
     * @param lineCommands 行内命令片段
     * @param document 当前文档
     * @param position 当前光标位置
     * @returns 补全项数组
     */
    public provideCommandCompletions(
        commands: string[],
        lineCommands: string[],
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        // 获取当前输入的文本片段（用于更精确的补全）
        const lineText = document.lineAt(position.line).text.substring(0, position.character);
        const currentInput = lineText.split(' ').pop() || '';
        // console.log(MinecraftCommandCompletionProvider.global_sufiix.length);
        // 第一级子命令: players 或 objectives 或 teams
        if (commands.length === 2) {
            return PRIMARY_SUB_COMMANDS.map(cmd =>
                this.createCompletionItem(
                    cmd.name,
                    cmd.desc,
                    `${cmd.insertText}${MinecraftCommandCompletionProvider.global_sufiix}`,
                    true,
                    this.keywordKind
                )
            );
        }

        // 处理players子命令
        if (commands[1]?.toLowerCase() === 'players') {
            return this.handlePlayersCommand(commands.slice(1), document, position, currentInput);
        }

        // 处理objectives子命令
        if (commands[1]?.toLowerCase() === 'objectives') {
            return this.handleObjectivesCommand(commands.slice(1), document, position, currentInput);
        }

        // 处理teams子命令（原代码缺失，补充基础框架）
        if (commands[1]?.toLowerCase() === 'teams') {
            return this.handleTeamsCommand(commands.slice(1));
        }

        return [];
    }

    /**
     * 处理players子命令的补全逻辑
     * @param subWords 以players为起始的命令片段
     * @param document 当前文档
     * @param position 当前光标位置
     * @param currentInput 当前输入的文本片段
     * @returns 补全项数组
     */
    private handlePlayersCommand(
        subWords: string[],
        document: vscode.TextDocument,
        position: vscode.Position,
        currentInput: string
    ): vscode.CompletionItem[] {
        // players的第一级操作
        if (subWords.length === 2) {
            return PLAYER_OPERATIONS.map(op =>
                this.createCompletionItem(
                    op.name,
                    op.desc,
                    `${op.insertText}${MinecraftCommandCompletionProvider.global_sufiix}`,
                    op.commitCharacter ?? true,
                    this.keywordKind
                )
            );
        }

        const operation = subWords[1]?.toLowerCase();
        if (!operation) { return []; }

        const supportedOperations = ['add', 'remove', 'set', 'reset', 'tag', 'enable'];

        // 处理玩家选择器相关操作
        if (supportedOperations.includes(operation)) {
            return this.handlePlayerOperation(subWords, operation, document, position, currentInput);
        }

        // 处理分数运算操作
        if (operation === 'operation') {
            return this.handleOperationCommand(subWords, document, position, currentInput);
        }

        return [];
    }

    /**
     * 处理玩家相关具体操作的补全
     * @param subWords 命令片段
     * @param operation 当前操作类型
     * @param document 当前文档
     * @param position 当前光标位置
     * @param currentInput 当前输入文本
     * @returns 补全项数组
     */
    private handlePlayerOperation(
        subWords: string[],
        operation: string,
        document: vscode.TextDocument,
        position: vscode.Position,
        currentInput: string
    ): vscode.CompletionItem[] {
        switch (subWords.length) {
            case 3:
                // 需要玩家选择器（@a @p @s等）
                return this.createSelectorArgumentsCompletion(currentInput, true);

            case 4:
                // 处理标签操作的子命令
                if (operation === 'tag') {
                    return TAG_OPERATIONS.map(op =>
                        this.createCompletionItem(op.name, op.desc, op.insertText + MinecraftCommandCompletionProvider.global_sufiix, true, vscode.CompletionItemKind.Constant)
                    );
                }
                // 其他操作需要计分板名称
                return this.createScoreboardNameCompletion(document, position, currentInput.length);

            case 5:
                // 标签操作需要标签名称；其他操作需要数值
                if (operation === 'tag') {
                    return this.createTagCompletion(document,position,currentInput.length); // 假设存在标签补全方法
                }
                // 需要数值参数的操作
                if (['add', 'set', 'remove'].includes(operation)) {
                    return [this.createCompletionItem(
                        "<value>",
                        "数值",
                        "",
                        false,
                        vscode.CompletionItemKind.Constant
                    )];
                }
                break;

            case 6:
                // 数据选项补全（仅特定操作）
                if (['add', 'set', 'remove', 'tag'].includes(operation)) {
                    return DATA_OPTIONS.map(option => this.createCompletionItem(
                        option.name,
                        option.desc,
                        `${option.insertText}${MinecraftCommandCompletionProvider.global_sufiix}`,
                        false,
                        option.kind
                    ));
                }
                break;
        }

        return [];
    }

    /**
     * 处理分数运算(operation)命令的补全
     * @param subWords 命令片段
     * @param document 当前文档
     * @param position 当前光标位置
     * @param currentInput 当前输入文本
     * @returns 补全项数组
     */
    private handleOperationCommand(
        subWords: string[],
        document: vscode.TextDocument,
        position: vscode.Position,
        currentInput: string
    ): vscode.CompletionItem[] {
        switch (subWords.length) {
            case 3:
                return this.createSelectorArgumentsCompletion(currentInput);

            case 4:
                return this.createScoreboardNameCompletion(document, position, currentInput.length);

            case 5:
                return OPERATORS.map(op =>
                    this.createCompletionItem(
                        op.name,
                        op.desc,
                        `${op.insertText}${MinecraftCommandCompletionProvider.global_sufiix}`,
                        true,
                        op.kind
                    )
                );

            case 6:
                return this.createSelectorArgumentsCompletion(currentInput, false);

            case 7:
                return this.createScoreboardNameCompletion(document, position, currentInput.length, false);
        }

        return [];
    }

    /**
     * 处理objectives子命令的补全逻辑
     * @param subWords 以objectives为起始的命令片段
     * @param document 当前文档
     * @param position 当前光标位置
     * @param currentInput 当前输入文本
     * @returns 补全项数组
     */
    private handleObjectivesCommand(
        subWords: string[],
        document: vscode.TextDocument,
        position: vscode.Position,
        currentInput: string
    ): vscode.CompletionItem[] {
        // objectives的第一级操作
        if (subWords.length === 2) {
            return OBJECTIVE_OPERATIONS.map(op =>
                this.createCompletionItem(
                    op.name,
                    op.desc,
                    `${op.insertText}${MinecraftCommandCompletionProvider.global_sufiix}`,
                    op.commitCharacter ?? true,
                    this.keywordKind
                )
            );
        }

        const operation = subWords[1]?.toLowerCase();
        if (!operation) { return []; }

        // 处理添加计分项操作
        if (operation === 'add') {
            return this.handleAddObjective(subWords, currentInput);
        }

        // 处理设置显示位置操作
        if (operation === 'setdisplay') {
            return this.handleSetDisplay(subWords, document, position, currentInput);
        }
        if (operation === 'remove' && subWords.length === 3) {
            return this.handleRemoveObjective(document, position, currentInput);
        }

        return [];
    }
    handleRemoveObjective(document: vscode.TextDocument, position: vscode.Position, currentInput: string): vscode.CompletionItem[] {
        return this.createScoreboardNameCompletion(document, position, currentInput.length, false);
    }

    /**
     * 处理添加计分项(add)的补全逻辑
     * @param subWords 命令片段
     * @param currentInput 当前输入文本
     * @returns 补全项数组
     */
    private handleAddObjective(subWords: string[], currentInput: string): vscode.CompletionItem[] {
        switch (subWords.length) {
            case 3:
                return this.isScoreboardNameCompletion
                    ? [this.createCompletionItem("<name>", "记分板名称", "", true)]
                    : [];

            case 4:
                const part = currentInput.toLowerCase(); // 使用当前输入而非整个片段，提高精度
                if (part.startsWith("stat")) {
                    // 物品相关统计补全
                    if (part.startsWith("stat.drop.minecraft")) {
                        return Object.entries(ItemNameMap.all).map(([name, desc]) =>
                            this.createCompletionItem(
                                name,
                                desc,
                                `${name}${MinecraftCommandCompletionProvider.global_sufiix}`,
                                true,
                                vscode.CompletionItemKind.Class
                            )
                        );
                    }
                    // 其他统计项补全
                    return MinecraftStatsDetail.all
                        .filter(stat => stat.name.toLowerCase().startsWith(part))
                        .map(stat =>
                            this.createCompletionItem(
                                stat.name,
                                stat.desc,
                                `${stat.name}${MinecraftCommandCompletionProvider.global_sufiix}`,
                                true,
                                vscode.CompletionItemKind.Enum
                            )
                        );
                }
                // 非stat开头的目标类型
                return MinecraftStats.all
                    .filter(obj => obj.name.toLowerCase().startsWith(part))
                    .map(objective =>
                        this.createCompletionItem(
                            objective.name,
                            objective.desc,
                            `${objective.name}${MinecraftCommandCompletionProvider.global_sufiix}`,
                            true,
                            vscode.CompletionItemKind.Enum
                        )
                    );

            case 5:
                // 计分板显示名称补全
                return [this.createCompletionItem("<displayName>", "显示名称（可选）", "", false)];
        }

        return [];
    }

    /**
     * 处理设置显示位置(setdisplay)的补全逻辑
     * @param subWords 命令片段
     * @param document 当前文档
     * @param position 当前光标位置
     * @param currentInput 当前输入文本
     * @returns 补全项数组
     */
    private handleSetDisplay(
        subWords: string[],
        document: vscode.TextDocument,
        position: vscode.Position,
        currentInput: string
    ): vscode.CompletionItem[] {
        switch (subWords.length) {
            case 3:
                // 显示位置补全
                return DISPLAY_POSITIONS
                    .filter(pos => pos.name.toLowerCase().startsWith(currentInput.toLowerCase()))
                    .map(pos =>
                        this.createCompletionItem(
                            pos.name,
                            pos.desc,
                            `${pos.name}${MinecraftCommandCompletionProvider.global_sufiix}`,
                            false,
                            pos.kind
                        )
                    );

            case 4:
                // 计分板名称补全
                return this.createScoreboardNameCompletion(document, position, currentInput.length);
        }

        return [];
    }

    /**
     * 处理teams子命令的基础补全（原代码缺失，补充）
     * @param subWords 命令片段
     * @returns 补全项数组
     */
    private handleTeamsCommand(subWords: string[]): vscode.CompletionItem[] {
        // 团队操作基础补全（可根据实际需求扩展）
        if (subWords.length === 2) {
            return [
                { name: 'add', desc: '添加队伍', insertText: 'add' },
                { name: 'remove', desc: '移除队伍', insertText: 'remove' },
                { name: 'join', desc: '加入队伍', insertText: 'join' },
                { name: 'leave', desc: '离开队伍', insertText: 'leave' },
                { name: 'list', desc: '列出队伍', insertText: 'list' },
                { name: 'option', desc: '设置队伍选项', insertText: 'option' }
            ].map(op => this.createCompletionItem(
                op.name,
                op.desc,
                `${op.insertText}${MinecraftCommandCompletionProvider.global_sufiix}`,
                true,
                this.keywordKind
            ));
        }
        return [];
    }






}