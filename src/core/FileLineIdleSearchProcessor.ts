import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DataLoader } from './DataLoader';

/**
 * 用于扫描 .mcfunction 文件中 scoreboard 相关的 tag 和 objective 信息
 * 维护文件行与标签/计分板的映射关系，支持实时更新和缓存管理
 */
export class FileLineIdleSearchProcessor {
    // 常量定义 - 增加语义化注释
    public static readonly TARGET_KEYWORD = 'scoreboard'; // 目标命令关键字（精确匹配）
    public static readonly MAX_SCANNED_FILE_SIZE = 1024 * 1024; // 最大扫描文件大小（1MB，防止大文件阻塞）

    // 全局缓存 - 存储所有有效的 tag 和 scoreboard
    public static TAGS: Set<string> = new Set();
    public static SCOREBOARDS: Map<string, [string, string]> = new Map(); // [目标, [类型, 显示名称]]

    // 单例实例
    private static instance: FileLineIdleSearchProcessor;

    // 行映射缓存 - 细化命名增强可读性
    private fileLineTagMap: Map<string, Map<number, string>> = new Map(); // { 文件路径: { 行号: tag } }
    private fileLineScoreboardMap: Map<string, Map<number, string>> = new Map(); // { 文件路径: { 行号: scoreboard目标 } }
    // 是否完成全局扫描
    public static isScanCompleted = false;

    /**
     * 获取单例实例
     */
    public static getInstance(): FileLineIdleSearchProcessor {
        if (!FileLineIdleSearchProcessor.instance) {
            FileLineIdleSearchProcessor.instance = new FileLineIdleSearchProcessor();
        }
        return FileLineIdleSearchProcessor.instance;
    }

    /**
     * 私有构造函数，防止外部实例化
     */
    private constructor() { }

    /**
     * 启动扫描流程入口
     */
    public start(): void {
        this.process().catch(err => {
            vscode.window.showErrorMessage(`文件扫描失败：${err.message}`);
            console.error('FileLineIdleSearchProcessor 扫描异常：', err);
        });
    }

    /**
     * 核心扫描逻辑（异步执行）
     */
    public async process(): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            vscode.window.showWarningMessage('未检测到打开的工作区，无法执行文件扫描');
            return false;
        }

        const fullFunctionRoot = path.join(DataLoader.getfunctionDirectory());
        try {
            await fs.access(fullFunctionRoot, fs.constants.F_OK); // 明确检查文件存在性
        } catch {
            vscode.window.showErrorMessage(`.mcfunction 根目录不存在：${fullFunctionRoot}`);
            return false;
        }

        const functionPaths = DataLoader.getFunctionPaths();
        if (functionPaths.length === 0) {
            vscode.window.showInformationMessage('未找到任何待扫描的 .mcfunction 文件');
            return true;
        }

        // 扫描前清空缓存（保持原子性）
        this.clearAllCaches();

        // 并发扫描文件（控制并发数防止资源占用过高）
        const concurrencyLimit = 5;
        for (let i = 0; i < functionPaths.length; i += concurrencyLimit) {
            const batch = functionPaths.slice(i, i + concurrencyLimit);
            await Promise.all(
                batch.map(relativePath => this.scanSingleFile(path.join(fullFunctionRoot, relativePath)))
            );
        }
        FileLineIdleSearchProcessor.isScanCompleted = true;

        return true;
    }

    /**
     * 扫描单个 .mcfunction 文件
     * @param fullFilePath 文件绝对路径
     */
    public async scanSingleFile(fullFilePath: string): Promise<void> {
        try {
            // 先检查文件状态（存在性和大小）
            const fileStats = await fs.stat(fullFilePath);
            if (fileStats.size > FileLineIdleSearchProcessor.MAX_SCANNED_FILE_SIZE) {
                console.warn(`跳过超大文件（${fileStats.size} 字节）：${fullFilePath}`);
                return;
            }

            const fileContent = await fs.readFile(fullFilePath, 'utf-8');
            const lines = fileContent.split(/\r?\n/);

            // 清除该文件历史记录（避免残留数据）
            this.fileLineTagMap.delete(fullFilePath);
            this.fileLineScoreboardMap.delete(fullFilePath);

            // 逐行处理
            lines.forEach((lineText, lineIndex) => {
                this.processLineUpdateByPath(fullFilePath, lineIndex, lineText);
            });

        } catch (err) {
            const error = err as Error;
            // 区分错误类型，提供更精准的提示
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(`文件不存在，已跳过：${fullFilePath}`);
                return;
            }
            vscode.window.showWarningMessage(`扫描文件失败：${path.basename(fullFilePath)}，原因：${error.message}`);
            console.error(`扫描文件 ${fullFilePath} 异常：`, error);
        }
    }

    /**
     * 通过文件路径处理单行更新（后台扫描用）
     * @param filePath 文件路径
     * @param lineNumber 行号（从0开始）
     * @param lineText 行文本内容
     */
    private processLineUpdateByPath(filePath: string, lineNumber: number, lineText: string): void {
        // 解析行内容为结构化参数（支持带引号的参数）
        const lineParts = this.parseCommandLine(lineText.trim());
        if (lineParts.length === 0) {return;}

        // 统一处理 tag 和 scoreboard 的提取与缓存更新
        this.processLineItemForTag(
            filePath,
            lineNumber,
            lineParts,
            this.extractTagFromLine.bind(this), // 提取器函数
            this.fileLineTagMap, // 行映射缓存
            FileLineIdleSearchProcessor.TAGS, // 全局集合
            this.removeTagIfNoOtherOccurrences.bind(this) // 清理函数
        );

        this.processLineItemForScoreboard(
            filePath,
            lineNumber,
            lineParts,
            this.extractScoreboardFromLine.bind(this),
            this.fileLineScoreboardMap,
            FileLineIdleSearchProcessor.SCOREBOARDS,
            this.removeScoreboardIfNoOtherOccurrences.bind(this)
        );
    }

    /**
     * 处理编辑器实时单行更新
     * @param document 文本文档
     * @param lineNumber 行号
     * @param lineText 行文本
     */
    public processLineUpdate(document: vscode.TextDocument, lineNumber: number, lineText: string): void {
        if (document.languageId !== 'mcfunction') {return;} // 只处理 mcfunction 文件
        this.processLineUpdateByPath(document.uri.fsPath, lineNumber, lineText);
    }

    /**
     * 扫描当前活动文档（编辑器实时更新用）
     * @param document 文本文档
     */
    public async scanActiveDocument(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== 'mcfunction') {return;}

        const filePath = document.uri.fsPath;
        // 先清除该文件的历史缓存
        this.clearFileCaches(filePath);

        // 逐行处理文档
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            this.processLineUpdate(document, i, line.text);
        }
    }

    /**
     * 解析命令行参数（支持带单/双引号的参数，引号内空格不拆分）
     * @param line 命令行文本
     * @returns 解析后的参数数组
     */
    private parseCommandLine(line: string): string[] {
        const parts: string[] = [];
        let currentPart = '';
        let inQuotes = false;
        let quoteChar: '"' | "'" | null = null;

        for (const char of line) {
            if (char === '"' || char === "'") {
                if (inQuotes && char === quoteChar) {
                    // 闭合引号
                    inQuotes = false;
                    quoteChar = null;
                } else if (!inQuotes) {
                    // 开启引号
                    inQuotes = true;
                    quoteChar = char as '"' | "'";
                } else {
                    // 不同引号类型，视为普通字符
                    currentPart += char;
                }
            } else if (char === ' ' && !inQuotes) {
                // 空格且不在引号中，分割参数
                if (currentPart) {
                    parts.push(currentPart);
                    currentPart = '';
                }
            } else {
                currentPart += char;
            }
        }

        // 添加最后一个参数（处理未闭合引号的情况，视为普通文本）
        if (currentPart) {
            parts.push(currentPart);
        }

        return parts;
    }

    /**
     * 从行参数中提取 tag（scoreboard players tag <目标> add <标签>）
     * @param lineParts 解析后的行参数数组
     * @returns 提取到的 tag，无则返回 null
     */
    private extractTagFromLine(lineParts: string[]): string | null {
        // 精确匹配命令前缀，避免类似 "scoreboardxyz" 的误判
        if (lineParts[0] !== FileLineIdleSearchProcessor.TARGET_KEYWORD) {return null;}

        // 匹配格式：scoreboard players tag <目标> add <标签>
        if (lineParts.length >= 6 && lineParts[1] === 'players' && lineParts[2] === 'tag' && lineParts[4] === 'add') {
            return lineParts[5];
        }
        return null;
    }

    /**
     * 从行参数中提取 scoreboard objective（scoreboard objectives add <目标> <类型> [显示名称]）
     * @param lineParts 解析后的行参数数组
     * @returns 提取到的 [目标, 类型, 显示名称]，无则返回 null
     */
    private extractScoreboardFromLine(lineParts: string[]): [string, string, string] | null {
        if (lineParts[0] !== FileLineIdleSearchProcessor.TARGET_KEYWORD) {return null;}

        // 匹配格式：scoreboard objectives add <目标> <类型> [显示名称]
        if (lineParts.length >= 5 && lineParts[1] === 'objectives' && lineParts[2] === 'add') {
            const displayName = lineParts.length >= 6 ? lineParts.slice(5).join(' ') : ''; // 支持显示名称含空格（已通过parse处理）
            return [lineParts[3], lineParts[4], displayName];
        }
        return null;
    }

    /**
     * 统一处理行项目（tag/scoreboard）的提取与缓存更新
     * 抽象重复逻辑，减少代码冗余
     */
    private processLineItemForTag(
        filePath: string,
        lineNumber: number,
        lineParts: string[],
        extractor: (parts: string[]) => string | null,
        lineMap: Map<string, Map<number, string>>,
        globalSet: Set<string>,
        removeFn: (item: string, path: string, line: number) => void
    ): void {
        // 初始化文件对应的行映射（不存在则创建）
        if (!lineMap.has(filePath)) {
            lineMap.set(filePath, new Map());
        }
        const fileLines = lineMap.get(filePath)!;

        // 移除旧项目
        const previousItem = fileLines.get(lineNumber);
        if (previousItem) {
            removeFn(previousItem, filePath, lineNumber);
            fileLines.delete(lineNumber);
        }

        // 添加新项目
        const newItem = extractor(lineParts);
        if (newItem) {
            fileLines.set(lineNumber, newItem);
            globalSet.add(newItem);
        }
    }

    /**
     * 统一处理行项目（tag/scoreboard）的提取与缓存更新
     * 抽象重复逻辑，减少代码冗余
     */
    private processLineItemForScoreboard(
        filePath: string,
        lineNumber: number,
        lineParts: string[],
        extractor: (parts: string[]) => [string, string, string] | null,
        lineMap: Map<string, Map<number, string>>,
        globalMap: Map<string, [string, string]>,
        removeFn: (item: string, path: string, line: number) => void
    ): void {
        // 初始化文件对应的行映射（不存在则创建）
        if (!lineMap.has(filePath)) {
            lineMap.set(filePath, new Map());
        }
        const fileLines = lineMap.get(filePath)!;

        // 移除旧项目
        const previousItem = fileLines.get(lineNumber);
        if (previousItem) {
            removeFn(previousItem, filePath, lineNumber);
            fileLines.delete(lineNumber);
        }

        // 添加新项目
        const newItem = extractor(lineParts);
        if (newItem) {
            fileLines.set(lineNumber, newItem[0]);
            globalMap.set(newItem[0], [newItem[1], newItem[2]]);
        }
    }

    /**
     * 检查并移除无引用的 tag
     */
    private removeTagIfNoOtherOccurrences(tag: string, currentFilePath: string, currentLineNumber: number): void {
        if (this.hasOtherOccurrences(tag, currentFilePath, currentLineNumber, this.fileLineTagMap)) {
            return;
        }
        FileLineIdleSearchProcessor.TAGS.delete(tag);
    }

    /**
     * 检查并移除无引用的 scoreboard
     */
    private removeScoreboardIfNoOtherOccurrences(scoreboard: string, currentFilePath: string, currentLineNumber: number): void {
        if (this.hasOtherOccurrences(scoreboard, currentFilePath, currentLineNumber, this.fileLineScoreboardMap)) {
            return;
        }
        FileLineIdleSearchProcessor.SCOREBOARDS.delete(scoreboard);
    }

    /**
     * 检查项目在其他位置是否有引用（抽象通用检查逻辑）
     */
    private hasOtherOccurrences<T>(
        item: T,
        currentFilePath: string,
        currentLineNumber: number,
        lineMap: Map<string, Map<number, T>>
    ): boolean {
        for (const [filePath, lines] of lineMap) {
            for (const [lineNumber, lineItem] of lines) {
                // 排除当前行，检查是否有其他引用
                if (!(filePath === currentFilePath && lineNumber === currentLineNumber) && lineItem === item) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 处理文件关闭，清理相关缓存
     */
    public handleDocumentClose(document: vscode.TextDocument): void {
        const filePath = document.uri.fsPath;
        this.clearFileCaches(filePath);
    }

    /**
     * 清空单个文件的缓存记录
     */
    private clearFileCaches(filePath: string): void {
        // 清理 tag 缓存
        if (this.fileLineTagMap.has(filePath)) {
            const fileTags = this.fileLineTagMap.get(filePath)!;
            fileTags.forEach(tag => this.removeTagIfNoOtherOccurrences(tag, filePath, -1));
            this.fileLineTagMap.delete(filePath);
        }

        // 清理 scoreboard 缓存
        if (this.fileLineScoreboardMap.has(filePath)) {
            const fileScoreboards = this.fileLineScoreboardMap.get(filePath)!;
            fileScoreboards.forEach(scoreboard => this.removeScoreboardIfNoOtherOccurrences(scoreboard, filePath, -1));
            this.fileLineScoreboardMap.delete(filePath);
        }
    }

    /**
     * 清空所有缓存记录
     */
    public clearAllCaches(): void {
        FileLineIdleSearchProcessor.TAGS.clear();
        FileLineIdleSearchProcessor.SCOREBOARDS.clear();
        this.fileLineTagMap.clear();
        this.fileLineScoreboardMap.clear();
    }

    // 静态工具方法 - tag 相关
    public static getTags(): Set<string> {
        return new Set(FileLineIdleSearchProcessor.TAGS); // 返回副本防止外部修改
    }

    public static existTag(tag: string): boolean {
        return FileLineIdleSearchProcessor.TAGS.has(tag);
    }

    public static addTag(tag: string): void {
        FileLineIdleSearchProcessor.TAGS.add(tag);
    }

    // 静态工具方法 - scoreboard 相关
    public static getScoreboards(): Map<string, [string, string]> {
        return new Map(FileLineIdleSearchProcessor.SCOREBOARDS); // 返回副本防止外部修改
    }

    public static getScoreboard(name: string): [string, string] | undefined {
        return FileLineIdleSearchProcessor.SCOREBOARDS.get(name);
    }

    public static existScoreboard(name: string): boolean {
        return FileLineIdleSearchProcessor.SCOREBOARDS.has(name);
    }

    public static addScoreboard(name: string, type: string, displayName: string): void {
        FileLineIdleSearchProcessor.SCOREBOARDS.set(name, [type, displayName]);
    }
}