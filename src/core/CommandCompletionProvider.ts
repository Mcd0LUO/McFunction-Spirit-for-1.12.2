import * as vscode from 'vscode';
import { CommandRegistry } from './CommandRegistry';
import { BlockNameMap, EntityNameList } from '../utils/EnumLib';
import { FileLineIdleSearchProcessor } from './FileLineIdleSearchProcessor';
import { ItemNameMap } from "../utils/EnumLib";
import { DocumentManager } from './DocumentManager';

export interface CommandsInfo {
    isExecute: boolean;       // 是否为 execute 命令
    isComplete: boolean;      // execute 是否完整（参数是否齐全）
    currentCommands: string[];// 当前命令片段
    paramStage: number;       // execute 未完整时的参数阶段（0-3：实体、x、y、z）
}

/**
 * Minecraft 1.12.2 命令补全基类
 * 负责处理命令解析、补全逻辑分发
 * 子类需实现 `provideCommandCompletions` 方法处理具体命令的补全
 */
export abstract class MinecraftCommandCompletionProvider implements vscode.CompletionItemProvider {


    /**
     * `execute` 命令的固定参数数量（实体选择器 + x + y + z）
     * 完整格式：`execute <实体> <x> <y> <z> <子命令>`
     */
    private static readonly EXECUTE_PARAM_COUNT = 4;

    public static global_sufiix: string = ' ';

    /**
     * 实体选择器补全数据（如 @a、@e 等）
     * 包含显示文本（label）和描述信息（detail）
        */
    public static readonly ENTITY_SELECTORS = [
        { label: '@a', detail: '所有玩家' },
        { label: '@e', detail: '所有实体' },
        { label: '@p', detail: '最接近的玩家' },
        { label: '@s', detail: '执行命令的自身' },
        { label: '@r', detail: '随机玩家' },
    ];

    /**
     * 坐标参数补全数据（如 ~、~0、0 等）
     * 包含显示文本、描述和补全项类型
     */
    public static readonly COORDINATE_COMPLETIONS = [
        { label: '~', detail: '相对坐标（基于当前位置）', kind: vscode.CompletionItemKind.Constant },
        { label: '~0', detail: '相对坐标（0偏移，等效于~）', kind: vscode.CompletionItemKind.Constant },
        { label: '0', detail: '绝对坐标（世界坐标）', kind: vscode.CompletionItemKind.Constant },
    ];

    /**
     * 选择器参数补全数据（如 score、tag、type 等）
     * 包含显示文本、描述和插入文本（带前缀符号）
     */
    public static readonly SELECTOR_ARGUMENTS = [
        { label: 'score', detail: '筛选指定计分板积分的实体', insertText: 'score_' },
        { label: 'tag', detail: '筛选带有指定标签的实体', insertText: 'tag=' },
        { label: 'r', detail: '筛选指定半径内的实体', insertText: 'r=' },
        { label: 'team', detail: '筛选指定队伍的实体', insertText: 'team=' },
        { label: 'name', detail: '筛选指定名称的实体', insertText: 'name=' },
        { label: 'c', detail: '限制筛选实体的数量（由近到远）', insertText: 'c=' },
        { label: 'x', detail: '筛选指定X坐标的实体', insertText: 'x=' },
        { label: 'y', detail: '筛选指定Y坐标的实体', insertText: 'y=' },
        { label: 'z', detail: '筛选指定Z坐标的实体', insertText: 'z=' },
        { label: 'type', detail: '筛选指定类型的实体', insertText: 'type=' },
        { label: 'rx', detail: '筛选垂直视角小于等于指定值的实体', insertText: 'rx=' },
        { label: 'rxm', detail: '筛选垂直视角大于等于指定值的实体', insertText: 'rxm=' },
        { label: 'ry', detail: '筛选水平视角小于等于指定值的实体', insertText: 'ry=' },
        { label: 'rym', detail: '筛选水平视角大于等于指定值的实体', insertText: 'rym=' },
        { label: 'dx', detail: '筛选X轴范围内的实体', insertText: 'dx=' },
        { label: 'dy', detail: '筛选Y轴范围内的实体', insertText: 'dy=' },
        { label: 'dz', detail: '筛选Z轴范围内的实体', insertText: 'dz=' },
        { label: 'rm', detail: '筛选指定半径外的实体', insertText: 'rm=' },
        { label: 'm', detail: '筛选指定游戏模式的玩家', insertText: 'm=' },
        { label: 'lm', detail: '筛选等级大于等于指定值的玩家', insertText: 'lm=' },
        { label: 'l', detail: '筛选等级小于等于指定值的玩家', insertText: 'l=' },
    ];



    /**
     * 补全主入口：解析命令并返回对应补全项
     * @param document 当前文档
     * @param position 光标位置
     * @param token 取消令牌
     * @param context 补全上下文
     * @returns 补全项数组或补全列表
     */
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        // 提取行文本并解析为命令片段（如 "execute @a ~ ~" → ["execute", "@a", "~", "~"]）
        // const lineText = document.lineAt(position.line).text;
        // const textBeforeCursor = lineText.substring(0, position.character);
        const lineCommands = DocumentManager.getInstance().getCommandSegments(document, position.line);
        // console.log(commands);
        // 无命令片段时，返回根命令补全
        if (!lineCommands || lineCommands.length === 0) {
            return this.provideRootCompletions('');
        }

        // 找到当前活跃的命令（处理多层嵌套 execute，优先处理最内层未完成的命令）
        const activeCommand = this.findActiveCommand(lineCommands);
        const { isExecute, isComplete, currentCommands, paramStage } = activeCommand;

        // 活跃命令是 execute 且未完整：补全 execute 自身的参数（实体、x、y、z）
        if (isExecute && !isComplete) {
            const executeProvider = CommandRegistry.getProvider('execute');
            return executeProvider ? executeProvider.provideCommandCompletions(currentCommands, lineCommands, document, position) : [];
        }

        // 活跃命令是 execute 且已完整：补全子命令（根命令，如 say、scoreboard 或嵌套的 execute）
        if (isExecute && isComplete) {
            const subCommandPrefix = currentCommands.slice(1 + MinecraftCommandCompletionProvider.EXECUTE_PARAM_COUNT)[0] || '';
            return this.provideRootCompletions(subCommandPrefix);
        }

        // 非 execute 命令的根命令补全：分发到对应命令的补全提供者
        const targetCommand = currentCommands[0] || '';
        if (!CommandRegistry.getProvider(targetCommand)) {
            return this.provideRootCompletions(targetCommand);
        }
        // 分发到对应命令的补全提供者
        const provider = CommandRegistry.getProvider(targetCommand);
        return provider ? provider.provideCommandCompletions(currentCommands, lineCommands, document, position) : [];
    }

    /**
     * 找到当前活跃的命令（最内层需要处理的命令）
     * 递归处理嵌套的 execute，直到找到未完整的 execute 或非 execute 命令
     * @param commands 原始命令片段数组
     * @returns 活跃命令信息（是否为 execute、是否完整、当前片段、参数阶段）
     */
    public findActiveCommand(commands: string[]): CommandsInfo {
        let currentCommands = [...commands];

        while (true) {
            const commandName = currentCommands[0]?.toLowerCase();

            // 非 execute 命令：直接作为活跃命令
            if (commandName !== 'execute') {
                return {
                    isExecute: false,
                    isComplete: true,
                    currentCommands,
                    paramStage: -1
                };
            }

            // 是 execute 命令：判断是否完整
            const isComplete = this.isExecuteComplete(currentCommands);
            if (!isComplete) {
                // 未完整的 execute：计算当前参数阶段
                const paramStage = this.getExecuteParamStage(currentCommands);
                return {
                    isExecute: true,
                    isComplete: false,
                    currentCommands,
                    paramStage
                };
            }

            // 已完整的 execute：跳过当前 execute，处理子命令
            currentCommands = currentCommands.slice(1 + MinecraftCommandCompletionProvider.EXECUTE_PARAM_COUNT);
        }
    }

    /**
     * 判断 execute 命令是否完整
     * 完整条件：长度 ≥ 5（含自身）且前4个参数（实体、x、y、z）均非空
     * @param commands 命令片段数组
     * @returns 是否完整
     */
    public isExecuteComplete(commands: string[]): boolean {
        // 长度不足（至少需要 "execute <实体> <x> <y> <z>" → 5个片段）
        if (commands.length < 1 + MinecraftCommandCompletionProvider.EXECUTE_PARAM_COUNT) {
            return false;
        }

        // 检查前4个参数是否非空（排除空字符串或纯空格）
        for (let i = 1; i <= MinecraftCommandCompletionProvider.EXECUTE_PARAM_COUNT; i++) {
            if (!commands[i]?.trim()) {
                return false;
            }
        }

        return true;
    }

    /**
     * 获取 execute 命令当前的参数阶段（未完整时有效）
     * 阶段定义：0=实体选择器，1=x坐标，2=y坐标，3=z坐标
     * @param commands 命令片段数组
     * @returns 参数阶段（0-3）
     */
    public getExecuteParamStage(commands: string[]): number {
        for (let stage = 0; stage < MinecraftCommandCompletionProvider.EXECUTE_PARAM_COUNT; stage++) {
            const paramIndex = 1 + stage; // 参数索引：实体=1，x=2，y=3，z=4
            // 若参数未输入或为空，则当前阶段为该参数
            if (paramIndex >= commands.length || !commands[paramIndex]?.trim()) {
                return stage;
            }
        }
        return MinecraftCommandCompletionProvider.EXECUTE_PARAM_COUNT - 1; // 理论上不会触发
    }


    /**
     * 从文本中提取命令片段（处理空格、引号、括号等特殊字符）
     * 增强版：正确处理JSON对象/数组内部的空格，将整个JSON视为单个参数
     * 例如：解析 "tellraw @s {\"text\": \"内容\"}" → ["tellraw", "@s", "{\"text\": \"内容\"}"]
     * 例如：解析 "execute @a[tag=test] ~ ~ ~ say" → ["execute", "@a[tag=test]", "~", "~", "~", "say"]
     * @param text 待解析的文本
     * @returns 命令片段数组
     */
    public extractCommand(text: string): string[] {

        const result: string[] = [];
        let start = 0;
        let inQuotes = false;
        let escapeNext = false;

        // 括号状态管理
        const bracketState = {
            selector: false,      // 选择器方括号 [ ]
            jsonObject: 0,        // JSON对象括号平衡 { } (计数器)
            jsonArray: 0          // JSON数组括号平衡 [ ] (计数器)
        };

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            // 处理转义字符
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            // 处理引号
            if (char === '"') {
                inQuotes = !inQuotes;
                continue;
            }

            if (!inQuotes) {
                // 处理选择器方括号（仅当不在JSON结构内时）
                if (char === '[' && bracketState.jsonObject === 0 && bracketState.jsonArray === 0) {
                    bracketState.selector = true;
                }
                // 关键修复：确保方括号闭合后正确重置选择器状态
                if (char === ']' && bracketState.selector) {
                    bracketState.selector = false;
                }

                // 处理JSON对象括号（计数器管理平衡）
                if (char === '{') { bracketState.jsonObject++; }
                if (char === '}') { bracketState.jsonObject = Math.max(0, bracketState.jsonObject - 1); }

                // 处理JSON数组括号（计数器管理平衡）
                if (char === '[') {
                    // 只有不在选择器括号内才计数JSON数组
                    if (!bracketState.selector) {
                        bracketState.jsonArray++;
                    }
                }
                if (char === ']') {
                    // 只有不在选择器括号内才计数JSON数组
                    if (!bracketState.selector) {
                        bracketState.jsonArray = Math.max(0, bracketState.jsonArray - 1);
                    }
                }
            }

            // 空格分割逻辑：仅当不在任何特殊结构内时
            const inSpecialStructure = inQuotes
                || bracketState.selector
                || bracketState.jsonObject > 0
                || bracketState.jsonArray > 0;

            if (char === ' ' && !inSpecialStructure) {
                if (i > start) {
                    // 提取当前片段（去除首尾空格，但保留内部空格）
                    const segment = text.substring(start, i).trim();
                    if (segment) {
                        result.push(segment);
                    }
                }
                start = i + 1;
            }
        }

        // 处理剩余片段
        const remaining = text.substring(start).trim();
        if (remaining) {
            result.push(remaining);
        }

        // 处理结尾空格的情况（添加空字符串表示下一个参数位置）
        if (text.length > 0 && text[text.length - 1] === ' ' && start >= text.length) {
            result.push('');
        }
        // console.log(result);
        return result;
    }



    /**
     * 提供根命令补全（如 /scoreboard、/execute、/say 等顶级命令）
     * @param text 已输入的命令前缀（用于筛选补全项）
     * @returns 根命令补全项数组
     */
    protected provideRootCompletions(text: string): vscode.CompletionItem[] {
        const prefix = text.trim().toLowerCase();
        // console.log(MinecraftCommandCompletionProvider.global_sufiix.length);
        return CommandRegistry.getRootCommands()
            .filter(command => prefix === '' || command.toLowerCase().startsWith(prefix))
            .map(command => this.createCompletionItem(
                command,
                `${command} 命令`,
                `${command}${MinecraftCommandCompletionProvider.global_sufiix}`,
                true // 自动触发下一级补全
            ));
    }

    /**
     * 抽象方法：子类需实现具体命令的补全逻辑
     * @param commands 命令片段数组
     * @param document 当前文档
     * @param position 光标位置
     * @returns 补全项数组
     */
    public abstract provideCommandCompletions(
        commands: string[],
        lineCommands: string[],
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[];

    /**
     * 创建补全项的工具方法
     * @param label 显示的文本
     * @param detail 描述信息（补全项下方的小字）
     * @param insertText 插入到文档的文本
     * @param triggerNext 是否自动触发下一级补全（输入后立即显示后续补全）
     * @param kind 补全项的类型（图标，如 Keyword、Enum 等）
     * @param range 
     * @returns 构建好的补全项
     */
    protected createCompletionItem(
        label: string,
        detail: string,
        insertText: string | vscode.SnippetString,
        triggerNext: boolean = true,
        kind: vscode.CompletionItemKind = vscode.CompletionItemKind.Keyword,
        range: vscode.Range | undefined = undefined
    ): vscode.CompletionItem {
        const item = new vscode.CompletionItem(label, kind);
        item.detail = detail;
        if (range) {
            item.range = range;
        }
        // item.insertText = insertText; // 直接赋值，支持 string 或 SnippetString 类型
        if (insertText instanceof vscode.SnippetString) {
            item.insertText = insertText;
        } else {
            item.insertText = new vscode.SnippetString(insertText);
        }

        // 自动触发下一级补全（提升用户体验，无需手动按 Ctrl+Space）
        if (triggerNext) {

            item.command = {
                command: 'editor.action.triggerSuggest',
                title: '触发下一级补全'
            };
        }

        return item;
    }

    protected createSingleCompletionItem(
        label: string,
        detail: string,
        insertText: string,
        triggerNext: boolean = true,
        kind: vscode.CompletionItemKind = vscode.CompletionItemKind.Keyword
    ): vscode.CompletionItem[] {
        return [this.createCompletionItem(label, detail, insertText, triggerNext, kind)];
    }

    /**
     * 创建实体选择器补全项（如 @a、@e 等）
     * @param triggerNext 是否自动触发下一级补全
     * @param suffix 选择器后附加的文本（如 " " 或 "["）
     * @returns 实体选择器补全项数组
     */

    protected createSelectorCompletion(
        triggerNext: boolean = true,
        suffix: string = ' '

    ): vscode.CompletionItem[] {
        return MinecraftCommandCompletionProvider.ENTITY_SELECTORS.map(selector =>
            this.createCompletionItem(
                selector.label,
                selector.detail,
                selector.label + suffix,
                triggerNext,
                vscode.CompletionItemKind.Enum
            )
        );
    }

    /**
     * 创建坐标参数补全项（如 ~、~0、0 等）
     * @param triggerNext 是否自动触发下一级补全
     * @returns 坐标补全项数组
     */
    protected createCoordinateCompletions(triggerNext: boolean = true): vscode.CompletionItem[] {

        return MinecraftCommandCompletionProvider.COORDINATE_COMPLETIONS.map(coord =>
            this.createCompletionItem(
                coord.label,
                coord.detail,
                `${coord.label} `,
                triggerNext,
                coord.kind
            )
        );
    }

    /**
     * 创建选择器参数补全项（如 score_、tag=、type= 等）
     * @param text 当前输入的文本（用于判断补全上下文）
     * @param triggerNext 是否自动触发下一级补全
     * @param suffix 参数后附加的文本（如 " " 或 ","）
     * @returns 选择器参数补全项数组
     */
    protected createSelectorArgumentsCompletion(
        text: string,
        triggerNext: boolean = true,
        suffix: string = ''
    ): vscode.CompletionItem[] {
        const trimmedText = text.trim();
        const trimmedTextLower = trimmedText.toLowerCase();
        // 上下文1：选择器参数开始（如 @a 或 @e, 后需要补全参数）
        // if (triggerNext) {
        //     suffix += " ";
        // }
        if (triggerNext === true && suffix === '') {
            suffix = " ";
        }

        if (trimmedText.endsWith('[') || trimmedTextLower.endsWith(',')) {



            return MinecraftCommandCompletionProvider.SELECTOR_ARGUMENTS.map(arg =>
                this.createCompletionItem(
                    arg.label,
                    arg.detail,
                    `${arg.insertText}`,
                    triggerNext,
                    vscode.CompletionItemKind.Enum
                )
            );
        }
        // 上下文2：score_ 前缀后补全计分板名称（如 score_money=10）
        if (trimmedTextLower.endsWith('score_') || trimmedTextLower.endsWith('score')) {
            const scoreboardNames = FileLineIdleSearchProcessor.getScoreboards();
            if (!scoreboardNames) { return []; }
            return Array.from(scoreboardNames.entries()).map(([name, data]) =>
                this.createCompletionItem(
                    `score_${name}`,
                    `类型: ${data[0]} 注释: ${data[1]}`,
                    `score_${name}`,
                    triggerNext,
                    vscode.CompletionItemKind.Enum
                )
            );
        }

        if (trimmedTextLower.endsWith('tag=')) {
            return Array.from(FileLineIdleSearchProcessor.TAGS).map(tag =>
                this.createCompletionItem(
                    tag,
                    `标签: ${tag}`,
                    `${tag}`,
                    true,
                    vscode.CompletionItemKind.Constant
                )
            );
        }

        // 上下文3：type= 后补全实体类型（如 type=Zombie）
        if (trimmedTextLower.endsWith('type=')) {
            return EntityNameList.all.map(entity =>
                this.createCompletionItem(
                    entity.name,
                    entity.desc,
                    `${entity.name}`,
                    true,
                    vscode.CompletionItemKind.Class
                )
            );
        }

        // 上下文4：空输入时补全选择器本身（如直接输入 @ 时）
        if (trimmedText === '') {
            return this.createSelectorCompletion(triggerNext, suffix);
        }

        return [];
    }

    // 创建物品补全项
    public createItemCompletion(): vscode.CompletionItem[] {
        const completionItems: vscode.CompletionItem[] = [];
        for (const [item, name] of Object.entries(ItemNameMap.all)) {

            completionItems.push(this.createCompletionItem(item, name, item + ' ', true, vscode.CompletionItemKind.Class));
        }
        return completionItems;
    }
    /**
     * 创建方块补全项
     * @returns 补全项数组
     */
    public createBlockCompletion(): vscode.CompletionItem[] {
        const completionItems: vscode.CompletionItem[] = [];
        for (const [block, desc] of Object.entries(BlockNameMap.all)) {

            completionItems.push(this.createCompletionItem(block, desc, block + ' ', true, vscode.CompletionItemKind.Class));
        }
        return completionItems;
    }

    /**
     * 创建计分板名称补全项
     * @param document 当前文档
     * @param position 当前位置
     * @param inputLength 输入长度
     * @param triggerNext 是否触发下一个补全
     * @returns 补全项数组
     */
    public createScoreboardNameCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        inputLength: number,
        triggerNext: boolean = true
    ): vscode.CompletionItem[] {
        const scoreboardNames = FileLineIdleSearchProcessor.getScoreboards();
        if (!scoreboardNames) {
            return [];
        }

        const range = this.getWordRange(document, position, inputLength);

        return Array.from(scoreboardNames.entries()).map(([name, data]) =>
            this.createCompletionItem(
                name,
                `类型: ${data[0]} 注释: ${data[1]}`,
                `${name}${MinecraftCommandCompletionProvider.global_sufiix}`,
                triggerNext,
                vscode.CompletionItemKind.Enum,
                range
            )
        );
    }

    /**
     * 创建标签补全（新增方法，处理tag操作的标签名称补全）
     * @param currentInput 当前输入
     * @returns 补全项数组
     */
    public createTagCompletion(currentInput: string): vscode.CompletionItem[] {
        // 实际应用中可从数据加载器获取已存在的标签
        const sampleTags = FileLineIdleSearchProcessor.getTags();
        return Array.from(sampleTags)
            .map(tag => this.createCompletionItem(
                tag,
                `玩家标签: ${tag}`,
                `${tag}${MinecraftCommandCompletionProvider.global_sufiix}`,
                false,
                vscode.CompletionItemKind.Constant
            ));
    }

    public createEntityNameCompletion(triggerNext: boolean): vscode.CompletionItem[] {
        return EntityNameList.all.map(entity =>
            this.createCompletionItem(
                entity.name,
                entity.desc,
                entity.name + MinecraftCommandCompletionProvider.global_sufiix,
                triggerNext ? triggerNext : false,
                vscode.CompletionItemKind.Class
            )
        );
    }

    /**
     * 获取当前输入文本的范围
     * @param document 当前文档
     * @param position 光标位置
     * @param inputLength 输入文本长度
     * @returns 文本范围或undefined
     */
    public getWordRange(
        document: vscode.TextDocument,
        position: vscode.Position,
        inputLength: number
    ): vscode.Range | undefined {
        const adjustedPosition = position.with(position.line, position.character - inputLength);
        return document.getWordRangeAtPosition(adjustedPosition);
    }


}