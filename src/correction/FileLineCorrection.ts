import * as vscode from 'vscode';
import { MainCompletionProvider } from "../core/MainCompletionProvider";
import { MinecraftUtils } from '../utils/MinecraftUtils';
import { DataLoader } from '../core/DataLoader';
import { FileLineIdleSearchProcessor } from '../core/FileLineIdleSearchProcessor';

/**
 * .mcfunction 文件命令检查器
 * 功能：实时检查命令语法错误并提供修复建议
 * 支持：计分板名称长度校验、函数存在性校验
 */
export class FileLineCorrection implements vscode.Disposable {
    // 单例实例
    public static readonly instance = new FileLineCorrection();

    // 错误缓存：键为行号，值为该行的错误数组
    private currentFileErrors = new Map<number, CorrectionError[]>();
    // 当前处理的文件路径
    private currentFilePath: string | null = null;
    // 诊断集合：用于在编辑器中显示错误
    private diagnosticCollection: vscode.DiagnosticCollection;
    // 防抖定时器
    private debounceTimer: NodeJS.Timeout | null = null;
    // 防抖延迟（平衡响应速度与性能）
    private static readonly DEBOUNCE_DELAY = 300;

    // 常量配置
    private static readonly MAX_SCOREBOARD_NAME_LENGTH = 16;
    private static readonly COMMAND_PREFIXES = {
        scoreObjAdd: 'scoreboard objectives add ',
        scorePlayerAdd: 'scoreboard players add ',
        scorePlayerSet: 'scoreboard players set ',
        scorePlayerReset: 'scoreboard players reset ',
        scorePlayerRemove: 'scoreboard players remove ',
        scorePlayerOpe: 'scoreboard players operation ',
        functionCall: 'function '
    };

    /**
     * 错误类型定义（包含警告等级）
     * - Error: 必须修复的错误
     * - Warning: 建议修复的问题
     */
    public static readonly ErrorType = {
        ScoreboardNameTooLong: {
            id: 'scoreboardNameTooLong',
            severity: vscode.DiagnosticSeverity.Error
        },
        FunctionNotExists: {
            id: 'functionNotExists',
            severity: vscode.DiagnosticSeverity.Warning
        },
        ScoreboardNotExists: {
            id: 'scoreboardNotExists',
            severity: vscode.DiagnosticSeverity.Warning
        }
    } as const;

    /**
     * 命令检查器配置
     * 统一管理所有命令的检查逻辑，便于扩展新命令
     */
    private readonly commandCheckers = [
        {
            commandPrefix: ['scoreboard', 'objectives', 'add'],
            checker: this.checkScoreboardNameLength.bind(this)
        },
        {
            commandPrefix: ['function'],
            checker: this.checkFunctionExists.bind(this)
        },
        {
            commandPrefix: ['scoreboard', 'players', 'add'],
            checker: this.checkScoreboardExists.bind(this)
        },
        {
            commandPrefix: ['scoreboard', 'players', 'set'],
            checker: this.checkScoreboardExists.bind(this)
        },
        {
            commandPrefix: ['scoreboard', 'players', 'remove'],
            checker: this.checkScoreboardExists.bind(this)
        },
        {
            commandPrefix: ['scoreboard', 'players', 'reset'],
            checker: this.checkScoreboardExists.bind(this)
        }
        ,
        {
            commandPrefix: ['scoreboard', 'players', 'operation'],
            checker: this.checkScoreboardExists.bind(this)
        }
    ] as const;

    private constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('mcfunction-command-check');
        this.initialize();
    }

    /** 初始化：注册事件监听 */
    private initialize(): void {
        this.registerDocumentEvents();
    }

    /** 注册文档相关事件监听 */
    private registerDocumentEvents(): void {
        // 文档内容变更事件
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId !== 'mcfunction') {return;}

            this.currentFilePath = event.document.uri.fsPath;
            const { changedLines, deletedLines } = this.analyzeTextChanges(event);

            this.debounce(async () => {
                // 处理删除的行
                deletedLines.forEach(line => this.currentFileErrors.delete(line));
                // 处理修改的行
                for (const line of changedLines) {
                    await this.handleDocumentChange(event.document, line);
                }
                // 更新诊断显示
                this.updateDiagnosticsForCurrentFile();
            });
        });

        // 文档关闭事件
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc.languageId === 'mcfunction' && this.currentFilePath === doc.uri.fsPath) {
                this.clearCurrentFileErrors();
                this.currentFilePath = null;
            }
        });

        // 切换活动编辑器事件
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.debounce(async () => {
                if (editor?.document.languageId === 'mcfunction') {
                    this.currentFilePath = editor.document.uri.fsPath;
                    await this.checkCurrentFile(editor.document);
                } else if (this.currentFilePath) {
                    this.clearCurrentFileErrors();
                    this.currentFilePath = null;
                }
            });
        });
    }

    /**
     * 分析文本变更，提取修改和删除的行号
     * @param event 文本变更事件
     * @returns 包含修改行和删除行的对象
     */
    private analyzeTextChanges(event: vscode.TextDocumentChangeEvent): {
        changedLines: Set<number>;
        deletedLines: number[];
    } {
        const changedLines = new Set<number>();
        const deletedLines: number[] = [];

        event.contentChanges.forEach(change => {
            const startLine = event.document.positionAt(change.rangeOffset).line;
            const endLine = event.document.positionAt(change.rangeOffset + change.rangeLength).line;

            // 判断是否为行删除
            if (change.text === '' && startLine < endLine) {
                for (let i = startLine; i <= endLine; i++) {
                    deletedLines.push(i);
                }
            } else {
                changedLines.add(startLine);
            }
        });

        return { changedLines, deletedLines };
    }

    /**
     * 防抖函数：避免短时间内重复执行
     * @param callback 待执行的回调函数
     */
    private debounce(callback: () => void | Promise<void>): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(async () => {
            try {
                await callback();
            } catch (error) {
                console.error('命令检查器执行出错:', error);
            } finally {
                this.debounceTimer = null;
            }
        }, FileLineCorrection.DEBOUNCE_DELAY);
    }

    /** 启动检查：插件激活时调用 */
    public start(): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor?.document.languageId === 'mcfunction') {
            this.checkCurrentFile(activeEditor.document);
        }
    }

    /**
     * 检查当前文件所有行
     * @param document 目标文档
     */
    public async checkCurrentFile(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== 'mcfunction') {return;}

        this.currentFilePath = document.uri.fsPath;
        this.clearCurrentFileErrors();

        // 批量检查所有行，使用Promise.all提高效率
        const checkPromises = [];
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            checkPromises.push(this.checkLineErrors(i, lineText));
        }
        await Promise.all(checkPromises);

        this.updateDiagnosticsForCurrentFile();
    }

    /**
     * 检查单行错误
     * @param lineNumber 行号
     * @param lineText 行文本
     */
    public async checkLineErrors(lineNumber: number, lineText: string): Promise<void> {
        const errors: CorrectionError[] = [];
        const trimmedLine = lineText.trim();

        // 跳过空行和注释行
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            this.updateLineErrors(lineNumber, errors);
            return;
        }

        // 提取命令并找到活跃命令片段（处理嵌套命令）
        const commandTokens = MainCompletionProvider.instance.extractCommand(trimmedLine);
        const activeCommand = MainCompletionProvider.instance.findActiveCommand(commandTokens);

        // 空安全处理：活跃命令不存在则返回
        if (!activeCommand?.currentCommands.length) {
            this.updateLineErrors(lineNumber, errors);
            return;
        }

        // 查找匹配的命令检查器
        const matchedChecker = this.commandCheckers.find(({ commandPrefix }) =>
            this.isCommandMatch(activeCommand.currentCommands, commandPrefix)
        );

        if (matchedChecker) {
            // 执行检查逻辑
            await matchedChecker.checker(lineText, activeCommand.currentCommands, errors);
        }

        this.updateLineErrors(lineNumber, errors);
    }

    /**
     * 检查命令是否匹配前缀
     * @param command 待检查的命令片段
     * @param prefix 命令前缀
     * @returns 是否匹配
     */
    private isCommandMatch(command: readonly string[] | string[], prefix: readonly string[] | string[]): boolean {
        // 命令长度不足前缀长度，直接不匹配
        if (command.length < prefix.length) {return false;}

        // 忽略大小写匹配每个前缀部分
        return prefix.every((part, index) =>
            command[index].toLowerCase() === part.toLowerCase()
        );
    }


    /**
     * 计算参数在原始行文本中的位置范围
     * @param lineText 原始行文本
     * @param commandPrefix 命令前缀
     * @param paramValue 参数值
     * @returns 位置范围 [起始索引, 长度]
     */
    private calculateParamRange(
        lineText: string,
        commandPrefix: string,
        paramValue: string
    ): [number, number] | null {
        // 查找命令前缀位置（忽略前导空格）
        const prefixIndex = lineText.indexOf(commandPrefix);
        if (prefixIndex === -1) {return null;}

        // 计算参数起始位置
        const paramStart = prefixIndex + commandPrefix.length;
        // 查找参数值在文本中的位置（处理可能的空格）
        const paramValueIndex = lineText.indexOf(paramValue, paramStart);

        // 未找到参数或参数位置异常
        if (paramValueIndex === -1 || paramValueIndex < paramStart) {return null;}

        return [paramValueIndex, paramValue.length];
    }

    /**
     * 更新单行错误缓存
     * @param lineNumber 行号
     * @param errors 错误数组
     */
    private updateLineErrors(lineNumber: number, errors: CorrectionError[]): void {
        if (errors.length > 0) {
            this.currentFileErrors.set(lineNumber, errors);
        } else {
            this.currentFileErrors.delete(lineNumber);
        }
    }

    /** 清除当前文件的所有错误缓存和诊断 */
    public clearCurrentFileErrors(): void {
        this.currentFileErrors.clear();
        if (this.currentFilePath) {
            this.diagnosticCollection.delete(vscode.Uri.file(this.currentFilePath));
        }
    }

    /** 更新当前文件的诊断显示 */
    private updateDiagnosticsForCurrentFile(): void {
        if (!this.currentFilePath) {return;}

        const uri = vscode.Uri.file(this.currentFilePath);
        const diagnostics: vscode.Diagnostic[] = [];

        this.currentFileErrors.forEach((errors, lineNumber) => {
            errors.forEach(error => {
                const [start, length] = error.range;
                const range = new vscode.Range(
                    new vscode.Position(lineNumber, start),
                    new vscode.Position(lineNumber, start + length)
                );

                const diagnostic = new vscode.Diagnostic(
                    range,
                    error.message,
                    error.type.severity
                );
                diagnostic.code = error.type.id;

                // 添加修复建议
                if (error.suggestions?.length) {
                    diagnostic.relatedInformation = error.suggestions.map(suggestion =>
                        new vscode.DiagnosticRelatedInformation(
                            new vscode.Location(uri, range),
                            suggestion
                        )
                    );
                }

                diagnostics.push(diagnostic);
            });
        });

        this.diagnosticCollection.set(uri, diagnostics);
    }

    /**
     * 处理文档变更
     * @param document 文档对象
     * @param lineNumber 变更的行号
     */
    public async handleDocumentChange(document: vscode.TextDocument, lineNumber: number): Promise<void> {
        if (document.languageId !== 'mcfunction' || lineNumber >= document.lineCount) {
            this.currentFileErrors.delete(lineNumber);
            return;
        }

        const lineText = document.lineAt(lineNumber).text;
        await this.checkLineErrors(lineNumber, lineText);
    }


    /**
     * 检查计分板名称长度
     * @param lineText 行文本
     * @param commandParts 命令片段
     * @param errors 错误收集数组
     */
    private checkScoreboardNameLength(
        lineText: string,
        commandParts: string[],
        errors: CorrectionError[]
    ): void {
        if (!DataLoader.getConfig()['check-scoreboard-length']) {return;}
        // 验证命令参数完整性
        if (commandParts.length < 4) { return; }

        const objectiveName = commandParts[3];
        // 检查名称长度
        if (objectiveName.length <= FileLineCorrection.MAX_SCOREBOARD_NAME_LENGTH) { return; }

        // 计算错误范围（精准定位名称位置）
        const range = this.calculateParamRange(
            lineText,
            FileLineCorrection.COMMAND_PREFIXES.scoreObjAdd,
            objectiveName
        );
        if (!range) { return; }

        errors.push({
            type: FileLineCorrection.ErrorType.ScoreboardNameTooLong,
            message: `计分板名称过长（${objectiveName.length}字符），最大允许${FileLineCorrection.MAX_SCOREBOARD_NAME_LENGTH}字符`,
            range,
            suggestions: [
                `缩短至${FileLineCorrection.MAX_SCOREBOARD_NAME_LENGTH}字符以内`,
                `使用缩写: "${objectiveName.substring(0, FileLineCorrection.MAX_SCOREBOARD_NAME_LENGTH)}..."`
            ]
        });
    }

    /**
     * 检查函数是否存在
     * @param lineText 行文本
     * @param commandParts 命令片段
     * @param errors 错误收集数组
     */
    private async checkFunctionExists(
        lineText: string,
        commandParts: string[],
        errors: CorrectionError[]
    ): Promise<void> {
        if (!DataLoader.getConfig()['check-data-exists']) {return;}
        // 验证命令参数完整性
        if (commandParts.length < 2) { return; }

        const functionName = commandParts[1];
        // 检查函数是否存在
        const exists = await MinecraftUtils.isFunctionExists(functionName);
        if (exists) { return; }

        // 计算错误范围（精准定位函数名位置）
        const range = this.calculateParamRange(
            lineText,
            FileLineCorrection.COMMAND_PREFIXES.functionCall,
            functionName
        );
        if (!range) { return; }

        errors.push({
            type: FileLineCorrection.ErrorType.FunctionNotExists,
            message: `函数 "${functionName}" 不存在`,
            range,
            suggestions: [
                `检查函数名拼写`,
                `确保文件存在于对应目录（data/functions/...）`
            ]
        });
    }


    private checkScoreboardExists(
        lineText: string,
        commandParts: string[],
        errors: CorrectionError[]
    ): void {
        if (!DataLoader.getConfig()['check-data-exists']) {return;}
        if (commandParts.length < 5) { return; }
        if (['add', 'remove', 'set','reset'].includes(commandParts[2])) {
            const scoreboardName = commandParts[4];
            if (!FileLineIdleSearchProcessor.SCOREBOARDS.has(scoreboardName)) {
                if (!FileLineIdleSearchProcessor.isScanCompleted) {
                    return;
                }
                let range;
                if (commandParts[2] === 'add') {
                    range = this.calculateParamRange(
                        lineText,
                        FileLineCorrection.COMMAND_PREFIXES.scorePlayerAdd,
                        scoreboardName
                    );
                }
                else if (commandParts[2] === 'remove') {
                    range = this.calculateParamRange(
                        lineText,
                        FileLineCorrection.COMMAND_PREFIXES.scorePlayerRemove,
                        scoreboardName
                    );
                }
                else if (commandParts[2] === 'set') {
                    range = this.calculateParamRange(
                        lineText,
                        FileLineCorrection.COMMAND_PREFIXES.scorePlayerSet,
                        scoreboardName
                    );
                }
                else if (commandParts[2] === 'reset') {
                    range = this.calculateParamRange(
                        lineText,
                        FileLineCorrection.COMMAND_PREFIXES.scorePlayerReset,
                        scoreboardName
                    );
                }
                if (!range) {
                    return;
                }
                errors.push({
                    type: FileLineCorrection.ErrorType.ScoreboardNotExists,
                    message: `计分板 "${scoreboardName}" 不存在`,
                    range,
                    suggestions: [
                        '检查计分板名拼写',
                        '确保记分板已被正确创建'
                    ]
                });
            }
        }
        else if (commandParts[2] === 'operation' && commandParts.length >= 7 && FileLineIdleSearchProcessor.isScanCompleted) {
            const scoreboardName_pre = commandParts[4];
            const scoreboardName_suf = commandParts[7];
            if (!FileLineIdleSearchProcessor.SCOREBOARDS.has(scoreboardName_pre)) {
                let range;
                range = this.calculateParamRange(
                    lineText,
                    FileLineCorrection.COMMAND_PREFIXES.scorePlayerOpe,
                    scoreboardName_pre
                );
                if (!range) {
                    return;
                }
                errors.push({
                    type: FileLineCorrection.ErrorType.ScoreboardNotExists,
                    message: `计分板 "${scoreboardName_pre}" 不存在`,
                    range,
                    suggestions: [
                        '检查计分板名拼写',
                        '确保记分板已被正确创建' 
                    ]
                });

            }
            else if (!FileLineIdleSearchProcessor.SCOREBOARDS.has(scoreboardName_suf)) {
                let range;
                range = this.calculateParamRange(
                    lineText,
                    FileLineCorrection.COMMAND_PREFIXES.scorePlayerOpe,
                    scoreboardName_suf
                );
                if (!range) {
                    return;
                }
                errors.push({
                    type: FileLineCorrection.ErrorType.ScoreboardNotExists,
                    message: `计分板 "${scoreboardName_pre}" 不存在`,
                    range,
                    suggestions: [
                        '检查计分板名拼写',
                        '确保记分板已被正确创建'
                    ]
                });

            }
        }

        // TODO: 实现检查计分板是否存在的逻辑
    }



    /** 释放资源 */
    dispose() {
        this.clearCurrentFileErrors();
        this.diagnosticCollection.dispose();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
    }
}

/** 错误信息接口定义 */
interface CorrectionError {
    type: (typeof FileLineCorrection.ErrorType)[keyof typeof FileLineCorrection.ErrorType];
    message: string;
    range: [number, number];
    suggestions?: string[];
}
