import * as vscode from 'vscode';
import { MainCompletionProvider } from './MainCompletionProvider';
import { FileLineIdleSearchProcessor } from './FileLineIdleSearchProcessor';
import { MinecraftUtils } from '../utils/MinecraftUtils';

/**
 * 每行命令解析结果的缓存结构
 * 用于存储单条命令的解析结果，避免重复解析
 */
interface LineParseResult {
    commandSegments: string[]; // 命令片段数组（按空格分割后的命令部分）
    lastParsed: number; // 最后解析时间戳（毫秒），用于判断缓存是否过期
}

/**
 * 文档缓存结构
 * 存储单个文档的解析缓存、标签/计分板映射及访问信息
 */
interface DocumentCache {
    uri: vscode.Uri; // 文档的唯一标识（URI）
    lineCache: Map<number, LineParseResult>; // 行号 -> 该行的解析结果缓存
    lineTagMap: Map<number, string>; // 行号 -> 该行定义的标签（tag）
    lineScoreboardMap: Map<number, string>; // 行号 -> 该行定义的计分板目标
    lastAccessed: number; // 最后访问时间戳（毫秒），用于缓存淘汰策略
    referencedFunctions: Map<vscode.Uri, number[]>;    // 自身被其它函数引用的函数列表 ,
    dispatchFunctions: Map<number, vscode.Uri>; // 自身调用的函数列表

}


/**
 * 文档管理器
 * 核心功能：整合文档缓存管理与标签/计分板信息提取
 * 负责维护文档解析缓存、实时更新标签和计分板数据、处理文档生命周期事件
 * 采用单例模式确保全局唯一实例
 */
export class DocumentManager {
    /** 单例实例：确保全局只有一个文档管理器实例 */
    private static instance: DocumentManager;
    /** 文档缓存池：以文档URI字符串为键，存储所有活跃文档的缓存数据 */
    private documentCache: Map<string, DocumentCache> = new Map();

    /** 单文档最大缓存行数：避免单个文档缓存过多行导致内存占用过高 */
    private static readonly MAX_CACHE_LINES_PER_DOC = 400;

    /**
     * 私有构造函数
     * 初始化事件监听器和定时缓存清理器，阻止外部直接实例化
     */
    private constructor() {
        this.initEventListeners(); // 注册文档相关事件监听
    }

    /**
     * 获取单例实例
     * 确保全局唯一的文档管理器实例，避免重复初始化
     * @returns DocumentManager 单例实例
     */
    public static getInstance(): DocumentManager {
        if (!DocumentManager.instance) {
            DocumentManager.instance = new DocumentManager();
        }
        return DocumentManager.instance;
    }

    /**
     * 初始化文档事件监听器
     * 监听文档打开、修改、保存、关闭等事件，确保缓存数据实时更新
     */
    private initEventListeners() {
        // 文档内容变更时：更新受影响行的缓存和标签/计分板数据
        vscode.workspace.onDidChangeTextDocument(event => {
            const uriStr = event.document.uri.toString();
            if (!this.documentCache.has(uriStr)) { return; }
            this.handleDocumentChanges(event);
        });
    }



    /**
     * 处理文档内容变更
     * 清理变更行的旧缓存，重新解析并更新标签/计分板数据
     * @param event 文本文档变更事件
     */
    public handleDocumentChanges(event: vscode.TextDocumentChangeEvent) {
        const cache = this.getOrCreateCache(event.document); // 获取该文档的缓存

        // 遍历所有变更区域，处理受影响的行
        event.contentChanges.forEach(change => {
            const startLine = change.range.start.line;
            const endLine = change.range.end.line;

            // 处理从startLine到endLine的所有行
            for (let line = startLine; line <= endLine; line++) {
                if (line >= event.document.lineCount) { continue; } // 跳过超出文档行数的无效行

                // 清理该行的旧缓存
                cache.lineCache.delete(line);
                cache.lineTagMap.delete(line);

                // 重新解析该行并更新缓存
                const lineText = event.document.lineAt(line).text;
                const trimmedLineText = lineText.trim();
                if (trimmedLineText.startsWith('#') || !trimmedLineText) {return;}
                this.processLine(event.document, line);
            }
        });

        // 更新文档最后访问时间
        cache.lastAccessed = Date.now();
    }

    /**
     * 获取或创建文档缓存
     * 若文档已存在缓存则返回，否则创建新缓存并添加到缓存池
     * @param document 目标文档
     * @returns 该文档的缓存对象
     */
    private getOrCreateCache(document: vscode.TextDocument): DocumentCache {
        const uriStr = document.uri.toString();
        let cache = this.documentCache.get(uriStr);

        // 若缓存不存在，创建新缓存
        if (!cache) {
            cache = {
                uri: document.uri,
                lineCache: new Map(),
                lineTagMap: new Map(),
                lineScoreboardMap: new Map(),
                lastAccessed: Date.now(),
                referencedFunctions: new Map<vscode.Uri, number[]>(),
                dispatchFunctions: new Map<number, vscode.Uri>()
            };
            this.documentCache.set(uriStr, cache);
        }

        return cache;
    }
    /**
     * 建立新文档缓存
     * 从缓存池中建立指定文档的缓存
     * @param uri 目标文档的uri
     */
    private setupDocumentCache(uri : vscode.Uri) : DocumentCache {
        let cache = this.documentCache.get(uri.toString());
        if (!cache) {
            cache = {
                uri: uri,
                lineCache: new Map(),
                lineTagMap: new Map(),
                lineScoreboardMap: new Map(),
                lastAccessed: Date.now(),
                referencedFunctions: new Map<vscode.Uri, number[]>(),
                dispatchFunctions: new Map<number, vscode.Uri>()
            };
            this.documentCache.set(uri.toString(), cache);
        }
        return cache;
    }

    /**
     * 获取文档中指定行的命令片段
     * 从缓存中获取，若缓存未命中则解析并缓存结果
     * @param document 目标文档
     * @param lineNumber 行号
     * @returns 命令片段数组（按空格分割）
     */
    public getCommandSegments(document: vscode.TextDocument, lineNumber: number): string[] {
        const cache = this.getOrCreateCache(document);

        // 检查缓存是否命中
        const lineCache = cache.lineCache.get(lineNumber);
        if (lineCache) {
            cache.lastAccessed = Date.now(); // 更新访问时间
            return [...lineCache.commandSegments]; // 返回缓存的命令片段
        }

        // 缓存未命中，解析该行命令
        const lineText = document.lineAt(lineNumber).text;
        const commandSegments = MainCompletionProvider.instance.extractCommand(lineText); // 调用补全提供者解析命令

        // 若缓存行数超过限制，淘汰最旧的行缓存
        if (cache.lineCache.size >= DocumentManager.MAX_CACHE_LINES_PER_DOC) {
            const oldestLine = Array.from(cache.lineCache.keys()).sort((a, b) => a - b)[0]; // 获取最旧行号
            cache.lineCache.delete(oldestLine);
        }

        // 存入缓存
        cache.lineCache.set(lineNumber, {
            commandSegments,
            lastParsed: Date.now()
        });
        cache.lastAccessed = Date.now(); // 更新访问时间

        return [...commandSegments];
    }

    /**
     * 扫描活跃文档
     * 全量解析文档内容，提取标签和计分板数据，更新缓存
     * @param document 目标文档
     */
    public async scanActiveDocument(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== 'mcfunction') { return; } // 仅处理 .mcfunction 文件

        try {
            // 检查文件大小，跳过超大文件（避免性能问题）
            const fileStats = await vscode.workspace.fs.stat(document.uri);
            if (fileStats.size > FileLineIdleSearchProcessor.MAX_SCANNED_FILE_SIZE) {
                console.warn(`跳过超大文件（${fileStats.size} 字节）：${document.uri.fsPath}`);
                return;
            }

            // 逐行解析文档
            for (let i = 0; i < document.lineCount; i++) {
                const lineText = document.lineAt(i).text;
                const trimmedLineText = lineText.trim();
                if (trimmedLineText.startsWith('#') || !trimmedLineText) {continue;}
                this.processLine(document, i);
            }

        } catch (err) {
            const error = err as Error;
            vscode.window.showWarningMessage(`扫描文档失败：${document.uri.fsPath}，原因：${error.message}`);
            console.error(`扫描文档异常：`, error);
        }
    }

    /**
     * 处理单行文本
     * 解析该行命令，提取标签和计分板数据，更新缓存和全局集合
     * @param document 目标文档
     * @param lineNumber 行号
     */
    private processLine(document: vscode.TextDocument, lineNumber: number): void {
        const commandSegments = this.getCommandSegments(document, lineNumber); // 获取命令片段

        if (commandSegments.length === 0) { return; } // 空命令不处理
        // 提取并更新标签（tag）
        const tag = this.extractTagFromLine(commandSegments);
        const cache = this.getOrCreateCache(document);
        if (tag) {
            cache.lineTagMap.set(lineNumber, tag); // 更新行-标签映射
            FileLineIdleSearchProcessor.TAGS.add(tag); // 添加到全局标签集合
        } else {
            cache.lineTagMap.delete(lineNumber); // 移除无效标签映射
        }

        // 提取并更新计分板（scoreboard）
        const scoreboard = this.extractScoreboardFromLine(commandSegments);
        if (scoreboard) {
            const [name, type, display] = scoreboard;
            // 检查是否已存在同一计分板在该行中
            const oldName = cache.lineScoreboardMap.get(lineNumber);
            if (oldName === name && FileLineIdleSearchProcessor.SCOREBOARDS.get(name)?.[0] === type && FileLineIdleSearchProcessor.SCOREBOARDS.get(name)?.[1] === display) {
                // console.log(`第 ${lineNumber} 存在 + ${name} + 计分板`);
                return; // 已存在，跳过
            }
            if (oldName) {
                this.removeScoreboardIfNoOtherOccurrences(oldName); // 移除旧计分板
            }
            cache.lineScoreboardMap.set(lineNumber, name); // 更新行-计分板映射
            let originRefferences = FileLineIdleSearchProcessor.SCOREBOARDS.get(name)?.[3];
            if (originRefferences) {
                FileLineIdleSearchProcessor.SCOREBOARDS.set(name, [type, display, document.uri, originRefferences + 1]); // 更新全局计分板映射
            } else {
                FileLineIdleSearchProcessor.SCOREBOARDS.set(name, [type, display, document.uri, 1]); // 添加到全局计分板映射
            }
        } else {
            // 若不存在有效计分板，清理旧映射并检查全局引用
            const oldScoreboard = cache.lineScoreboardMap.get(lineNumber);
            if (oldScoreboard) {
                cache.lineScoreboardMap.delete(lineNumber);
                this.removeScoreboardIfNoOtherOccurrences(oldScoreboard);
            }
        }
        // 标记function行
        if (commandSegments[0] === 'function') {
            const functionCall = this.extractFunctionFromLine(commandSegments);
            if (functionCall) {
                // 获取自身调用的函数uri
                const functionUri = MinecraftUtils.buildFunctionUri(functionCall);
                if (functionUri) {
                    // 添加到对应函数的引用列表中
                    const cache = this.setupDocumentCache(functionUri);
                    const currentLines = cache.referencedFunctions.get(document.uri) || [];
                    currentLines.push(lineNumber);
                    cache.referencedFunctions.set(document.uri, currentLines);
                    // 添加自身对函数的引用
                    cache.dispatchFunctions.set(lineNumber, functionUri);
                } else {
                    // 获取本行引用的函数uri
                    const dispatchFunction = cache.dispatchFunctions.get(lineNumber);
                    // 清除本行对函数的引用
                    cache.dispatchFunctions.delete(lineNumber);
                    // 清除调用的函数记录的自身引用
                    if (dispatchFunction) {
                        const refLines = this.documentCache.get(dispatchFunction.toString())?.referencedFunctions.get(document.uri);
                        if (refLines) {
                            const updatedLines = refLines.filter(line => line !== lineNumber);
                            if (updatedLines.length > 0) {
                                this.documentCache.get(dispatchFunction.toString())?.referencedFunctions.set(document.uri, updatedLines);
                            } else {
                                this.documentCache.get(dispatchFunction.toString())?.referencedFunctions.delete(document.uri);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * 从命令片段中提取标签（tag）
     * 匹配 "scoreboard tag <标签名>" 格式的命令
     * @param segments 命令片段数组
     * @returns 标签名（不存在则返回null）
     */
    private extractTagFromLine(segments: string[]): string | null {
        // 匹配格式：scoreboard tag <target> ... → 提取<target>作为标签名
        if (segments.length >= 3 && segments[0] === 'scoreboard' && segments[1] === 'tag') {
            return segments[2];
        }
        return null;
    }

    private extractFunctionFromLine(segments: string[]): string | null {
        // 匹配格式：function <NameSpace>:<functionName>
        if (segments.length >= 2 && segments[0] === 'function') {
            return segments[1];
        }
        return null;
    }

    /**
     * 从命令片段中提取计分板目标
     * 匹配 "scoreboard objectives add <名称> <类型> [显示名]" 格式的命令
     * @param segments 命令片段数组
     * @returns [名称, 类型, 显示名]（不存在则返回null）
     */
    private extractScoreboardFromLine(segments: string[]): [string, string, string] | null {
        // 匹配格式：scoreboard objectives add <name> <type> [display]
        if (segments.length >= 5 && segments[0] === 'scoreboard' && segments[1] === 'objectives' && segments[2] === 'add' && segments[4] !== '') {
            return [segments[3], segments[4], segments[5] || segments[3]]; // 显示名默认与名称相同
        }
        return null;
    }

    /**
     * 清理文档缓存
     * 移除文档的所有缓存数据，并清理全局集合中该文档独有的标签/计分板
     * @param uriStr 文档URI字符串
     */
    public cleanupDocumentCache(uriStr: string): void {
        const cache = this.documentCache.get(uriStr);
        if (!cache) { return; }

        // 清理该文档的标签引用
        cache.lineTagMap.forEach((tag, line) => {
            this.removeTagIfNoOtherOccurrences(tag, uriStr, line);
        });

        // 清理该文档的计分板引用
        cache.lineScoreboardMap.forEach((scoreboard) => {
            this.removeScoreboardIfNoOtherOccurrences(scoreboard);
        });
        cache.dispatchFunctions.clear();
        cache.referencedFunctions.clear();
        cache.lineTagMap.clear();
        cache.lineScoreboardMap.clear();
        // 从缓存池中移除该文档
        this.documentCache.delete(uriStr);
    }

    /*
    * 清理所有文档缓存
    */
    public cleanupAllDocumentCache(): void {
        this.documentCache.forEach((cache, uriStr) => {
            this.cleanupDocumentCache(uriStr);
        });
    }




    /**
     * 检查标签是否在其他位置被引用
     * 若当前行是该标签的最后一处引用，则从全局集合中移除
     * @param tag 标签名
     * @param uriStr 当前文档URI字符串
     * @param line 当前行号
     */
    private removeTagIfNoOtherOccurrences(tag: string, uriStr: string, line: number): void {
        let hasOtherOccurrences = false;

        // 遍历所有文档缓存，检查是否有其他引用
        this.documentCache.forEach((cache, currentUriStr) => {
            if (currentUriStr === uriStr) {
                // 检查同文档其他行是否有引用
                cache.lineTagMap.forEach((t, l) => {
                    if (t === tag && l !== line) { hasOtherOccurrences = true; }
                });
            } else {
                // 检查其他文档是否有引用
                if (Array.from(cache.lineTagMap.values()).includes(tag)) { hasOtherOccurrences = true; }
            }
        });

        // 若没有其他引用，从全局集合中移除
        if (!hasOtherOccurrences) {
            FileLineIdleSearchProcessor.TAGS.delete(tag);
        }
    }

    /**
     * 检查计分板是否在其他位置被引用创建
     * 若当前行是该计分板的最后一处引用，则从全局集合中移除
     * @param scoreboard 计分板名称
     * @param uriStr 当前文档URI字符串
     * @param line 当前行号
     */
    private removeScoreboardIfNoOtherOccurrences(scoreboard: string): void {
        let hasOtherOccurrences = false;

        //获取引用计数
        let scoreboardCount = FileLineIdleSearchProcessor.SCOREBOARDS.get(scoreboard)?.[3];
        if (scoreboardCount === undefined) { scoreboardCount = 0; }
        scoreboardCount -= 1;
        if (scoreboardCount <= 0) {
            hasOtherOccurrences = true;
        }

        // 若没有其他引用，从全局集合中移除
        if (!hasOtherOccurrences) {
            console.log("移除" ,scoreboard);
            FileLineIdleSearchProcessor.SCOREBOARDS.delete(scoreboard);
        }
    }

    /**
     * 延迟执行辅助函数
     * @param ms 延迟毫秒数
     * @returns 延迟完成的Promise
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    /**
     *  公开方法：获取指定函数的引用列表
     * @param functionRes 
     * @returns 
     */
    public getFunctionRefferences(functionRes: string): Map<vscode.Uri, number[]> | null {
        const funcUri = MinecraftUtils.buildFunctionUri(functionRes);
        if (!funcUri) { return null; }
        return this.documentCache.get(funcUri.toString())?.referencedFunctions || null;
    }

}