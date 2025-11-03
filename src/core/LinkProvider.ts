import * as vscode from 'vscode';
import { MainCompletionProvider } from '../core/MainCompletionProvider';
import { MinecraftUtils } from '../utils/MinecraftUtils';
import { DocumentManager } from './DocumentManager';
import { DataLoader } from './DataLoader';

/** 命令策略接口：定义不同命令的链接生成规则（策略模式核心） */
interface CommandLinkStrategy {
    command: string;
    matchRegex: RegExp;
    validate(tokens: string[], activeCommand: ActiveCommandInfo): boolean;
    getPathTokenIndex(startTokenIndex: number): number;
    validatePath(path: string): boolean;
    buildTargetUri(path: string): Promise<vscode.Uri | null>; // 异步避免阻塞
    getTooltip(path: string): string;
}

/** 活跃命令信息 */
interface ActiveCommandInfo {
    currentCommands: string[];
    isExecute: boolean;
    isComplete: boolean;
}

/** 令牌信息（含原始位置，避免反查） */
interface TokenWithPosition {
    value: string;
    start: number; // 令牌在commandText中的起始位置（相对commandText）
    end: number;   // 令牌在commandText中的结束位置（相对commandText）
}

/** 链接元数据（缓存用，不依赖行号和缩进） */
interface LinkMetadata {
    path: string;
    command: string;
    tokenStart: number; // 路径token在commandText中的起始位置（相对commandText）
    tokenEnd: number;   // 路径token在commandText中的结束位置（相对commandText）
}

/** 文档级缓存：隔离不同文档的缓存，提升查找效率 */
interface DocumentCache {
    metaCache: LRUCache<number, LinkMetadata[]>; // key: 行号
    tokenCache: LRUCache<number, TokenWithPosition[]>; // key: 行号
    lastAccessed: number; // 最后访问时间（用于清理长期未使用的文档缓存）
}

/** 缓存管理器：集中管控元数据缓存、令牌缓存、路径缓存（优化查找+LRU淘汰） */
class LinkCacheManager {
    /** 全局文档缓存：key = 文档URI.fsPath（更高效的键），value = 文档级缓存 */
    private docCaches = new Map<string, DocumentCache>();
    /** 路径→URI缓存（全局共享）：key = 命令名:路径（小写），value = 异步URI Promise */
    private pathUriCache = new LRUCache<string, Promise<vscode.Uri | null>>(1000); // LRU上限1000


    /** 缓存配置（平衡性能与内存） */
    private static readonly CACHE_CONFIG = {
        metaCacheSize: 500,    // 单文档元数据缓存上限（行）
        tokenCacheSize: 500,   // 单文档令牌缓存上限（行）
        docCacheTTL: 3600000,  // 文档缓存过期时间（1小时，无访问则清理）
        metaCacheTTL: 300000,  // 元数据缓存TTL（5分钟）
        tokenCacheTTL: 60000,  // 令牌缓存TTL（1分钟）
        pathUriCacheTTL: 600000// 路径URI缓存TTL（10分钟）
    };

    /** 生成文档缓存键（用fsPath更高效，避免URI.toString()冗余） */
    private getDocKey(uri: vscode.Uri): string {
        return uri.fsPath;
    }

    /** 获取/初始化文档级缓存（隔离不同文档，O(1)访问） */
    private getDocCache(uri: vscode.Uri): DocumentCache {
        const docKey = this.getDocKey(uri);
        let docCache = this.docCaches.get(docKey);

        if (!docCache) {
            // 初始化文档缓存（LRU淘汰，避免单文档缓存膨胀）
            docCache = {
                metaCache: new LRUCache<number, LinkMetadata[]>(LinkCacheManager.CACHE_CONFIG.metaCacheSize),
                tokenCache: new LRUCache<number, TokenWithPosition[]>(LinkCacheManager.CACHE_CONFIG.tokenCacheSize),
                lastAccessed: Date.now()
            };
            this.docCaches.set(docKey, docCache);

            // 定期清理长期未访问的文档缓存（防止内存泄漏）
            this.scheduleDocCacheCleanup();
        } else {
            // 更新最后访问时间，避免被误清理
            docCache.lastAccessed = Date.now();
        }

        return docCache;
    }

    /** 定期清理过期文档缓存（每30分钟执行一次） */
    private scheduleDocCacheCleanup(): void {
        if (this.cleanupTimer) {return;}
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            const expiredThreshold = now - LinkCacheManager.CACHE_CONFIG.docCacheTTL;

            this.docCaches.forEach((docCache, docKey) => {
                if (docCache.lastAccessed < expiredThreshold) {
                    this.docCaches.delete(docKey);
                    this.log(`清理过期文档缓存：${docKey}`);
                }
            });
        }, 1800000); // 30分钟
    }

    private cleanupTimer?: NodeJS.Timeout;

    // ------------------------------ 缓存读写（优化查找效率） ------------------------------
    getMetaCache(uri: vscode.Uri, lineNumber: number): LinkMetadata[] | undefined {
        return this.getDocCache(uri).metaCache.get(lineNumber);
    }

    setMetaCache(uri: vscode.Uri, lineNumber: number, meta: LinkMetadata[]): void {
        const docCache = this.getDocCache(uri);
        docCache.metaCache.set(lineNumber, meta);
        // 单独设置过期时间（LRU+TTL双重保障）
        setTimeout(() => {
            docCache.metaCache.delete(lineNumber);
        }, LinkCacheManager.CACHE_CONFIG.metaCacheTTL);
    }

    getTokenCache(uri: vscode.Uri, lineNumber: number): TokenWithPosition[] | undefined {
        return this.getDocCache(uri).tokenCache.get(lineNumber);
    }

    setTokenCache(uri: vscode.Uri, lineNumber: number, tokens: TokenWithPosition[]): void {
        const docCache = this.getDocCache(uri);
        docCache.tokenCache.set(lineNumber, tokens);
        setTimeout(() => {
            docCache.tokenCache.delete(lineNumber);
        }, LinkCacheManager.CACHE_CONFIG.tokenCacheTTL);
    }

    async getPathUriCache(path: string, command: string): Promise<vscode.Uri | null> {
        const key = `${command.toLowerCase()}:${path.toLowerCase()}`;
        let uriPromise = this.pathUriCache.get(key);

        if (!uriPromise) {
            // 异步构建URI，避免阻塞主线程
            uriPromise = (async () => {
                try {
                    const strategy = LinkProvider.getInstance().getStrategyByCommand(command);
                    return strategy ? await strategy.buildTargetUri(path) : null;
                } catch (err) {
                    this.log(`构建URI失败：${command} -> ${path}`, err);
                    return null;
                }
            })();
            this.pathUriCache.set(key, uriPromise);
            // 过期自动删除
            setTimeout(() => {
                this.pathUriCache.delete(key);
            }, LinkCacheManager.CACHE_CONFIG.pathUriCacheTTL);
        }

        return uriPromise;
    }

    // ------------------------------ 缓存清理与偏移调整（核心优化） ------------------------------
    /** 增量清理：仅清理变更行缓存（O(1)） */
    clearLineCache(uri: vscode.Uri, lineNumbers: number[]): void {
        const docCache = this.getDocCache(uri);
        lineNumbers.forEach(line => {
            docCache.metaCache.delete(line);
            docCache.tokenCache.delete(line);
            this.log(`清理行缓存：${uri.fsPath} -> 行${line}`);
        });
    }

    /** 行号偏移调整（O(k)，k为受影响行数量，远优于原O(n)） */
    adjustLineOffsets(uri: vscode.Uri, changeEndLine: number, deltaLines: number): void {
        if (deltaLines === 0) { return; }

        const docCache = this.getDocCache(uri);
        const affectedMeta: [number, LinkMetadata[]][] = [];
        const affectedTokens: [number, TokenWithPosition[]][] = [];

        // 收集所有受影响的行（大于变更结束行的行）
        docCache.metaCache.forEach((meta, line) => {
            if (line > changeEndLine) {
                affectedMeta.push([line, meta]);
            }
        });
        docCache.tokenCache.forEach((tokens, line) => {
            if (line > changeEndLine) {
                affectedTokens.push([line, tokens]);
            }
        });

        // 移除旧行号缓存并添加新行号缓存
        affectedMeta.forEach(([oldLine, meta]) => {
            docCache.metaCache.delete(oldLine);
            const newLine = oldLine + deltaLines;
            docCache.metaCache.set(newLine, meta);
        });
        affectedTokens.forEach(([oldLine, tokens]) => {
            docCache.tokenCache.delete(oldLine);
            const newLine = oldLine + deltaLines;
            docCache.tokenCache.set(newLine, tokens);
        });

        this.log(`行号偏移调整：${uri.fsPath} -> 行${changeEndLine}后偏移${deltaLines}行`);
    }

    /** 清理文档全量缓存（文档关闭/重命名时） */
    clearDocumentCache(uri: vscode.Uri): void {
        const docKey = this.getDocKey(uri);
        this.docCaches.delete(docKey);
        this.log(`清理文档全量缓存：${docKey}`);
    }

    /** 清理旧URI缓存（文档重命名/移动时） */
    clearOldUriCache(oldUri: vscode.Uri): void {
        this.clearDocumentCache(oldUri);
    }

    // ------------------------------ 日志工具（便于问题排查） ------------------------------
    private log(message: string, error?: unknown): void {
        if (LinkProvider.DEBUG_MODE) {
            const prefix = '[LinkProvider Cache]';
            if (error) {
                console.error(`${prefix} ${message}`, error);
            } else {
                console.log(`${prefix} ${message}`);
            }
        }
    }

    /** 销毁缓存管理器（插件卸载时） */
    dispose(): void {
        if (this.cleanupTimer) {clearInterval(this.cleanupTimer);}
        this.docCaches.clear();
        this.pathUriCache.clear(); // 现在LRUCache有clear方法
        this.log('缓存管理器已销毁');
    }
}

/** Function命令策略 */
class FunctionCommandStrategy implements CommandLinkStrategy {
    command = 'function';
    matchRegex = /(^|\s)function\b/i;

    validate(tokens: string[], activeCommand: ActiveCommandInfo): boolean {
        if (!tokens.length) {return false;}
        return activeCommand.isExecute ? activeCommand.isComplete : tokens.length > this.getPathTokenIndex(0);
    }

    getPathTokenIndex(startTokenIndex: number): number {
        return startTokenIndex + 1;
    }

    validatePath(path: string): boolean {
        return /^[^ ]+$/.test(path);
    }

    async buildTargetUri(path: string): Promise<vscode.Uri | null> {
        return MinecraftUtils.buildResourceUri(path, 'functions', '.mcfunction');
    }

    getTooltip(path: string): string {
        const [ns, funcPath] = MinecraftUtils.parseResourcePath(path) || ['', path];
        return `跳转到函数：${ns}/${funcPath}.mcfunction`;
    }
}

/** Advancement命令策略 */
class AdvancementCommandStrategy implements CommandLinkStrategy {
    command = 'advancement';
    matchRegex = /(^|\s)advancement\b/i;
    private validActions = new Set(['grant', 'revoke', 'test']);

    validate(tokens: string[], activeCommand: ActiveCommandInfo): boolean {
        if (!tokens.length) {return false;}
        if (activeCommand.isExecute && !activeCommand.isComplete) {return false;}
        const pathIndex = this.getPathTokenIndex(0);
        if (tokens.length <= pathIndex) {return false;}
        const actionTokens = tokens.slice(1, pathIndex);
        return actionTokens.some(action => this.validActions.has(action.toLowerCase()));
    }

    getPathTokenIndex(startTokenIndex: number): number {
        return startTokenIndex + 4;
    }

    validatePath(path: string): boolean {
        return /^[^:]+:[^ ]+$/.test(path);
    }

    async buildTargetUri(path: string): Promise<vscode.Uri | null> {
        return MinecraftUtils.buildResourceUri(path, 'advancements', '.json');
    }

    getTooltip(path: string): string {
        const [ns, advPath] = MinecraftUtils.parseResourcePath(path) || ['', path];
        return `跳转到进度：${ns}/${advPath}.json`;
    }
}

/** 文档链接提供器（单例+高性能+高稳定） */
export class LinkProvider implements vscode.DocumentLinkProvider {
    public static readonly DEBUG_MODE = false; // 调试模式开关（默认关闭，不影响性能）
    private static instance: LinkProvider;
    private commandStrategies: Map<string, CommandLinkStrategy> = new Map();
    private cacheManager = new LinkCacheManager();
    private static readonly SUPPORTED_LANGUAGES = new Set(['mcfunction']);
    // 新增：存储当前激活文档的可视区域行号（实时更新）
    private debounceTimer: NodeJS.Timeout | null = null;
    public static readonly DEBOUNCE_DELAY = 100; // 缩短防抖时间（滚动停止后快速触发）

    /** 记录每个文档已解析的行号（避免重复解析） */
    private resolvedLines = new Map<string, Set<number>>();

    private constructor() {
        this.initStrategies();
        this.initEventListeners();
    }

    public static getInstance(): LinkProvider {
        if (!LinkProvider.instance) {
            LinkProvider.instance = new LinkProvider();
        }
        return LinkProvider.instance;
    }

    private initStrategies(): void {
        const strategies = [new FunctionCommandStrategy(), new AdvancementCommandStrategy()];
        strategies.forEach(strategy => {
            this.commandStrategies.set(strategy.command.toLowerCase(), strategy);
        });
    }

    /** 初始化事件监听（新增滚动监听） */
    private initEventListeners(): void {
        // 1. 文本变更：增量清理缓存 + 行号偏移（增量更新核心）
        vscode.workspace.onDidChangeTextDocument(event => {
            if (!LinkProvider.SUPPORTED_LANGUAGES.has(event.document.languageId)) { return; }
            const document = event.document;
            const docKey = this.getDocKey(document.uri);
            const resolvedLines = this.resolvedLines.get(docKey) || new Set();

            event.contentChanges.forEach(change => {
                const startLine = change.range.start.line;
                const endLine = change.range.end.line;
                const oldLineCount = endLine - startLine + 1;
                const newLineCount = change.text.split(/\r?\n/).length;
                const deltaLines = newLineCount - oldLineCount;

                // 1. 清理所有受影响的行缓存（包括变更行及后续所有行）
                const changedLines: number[] = [];
                // 清理变更行本身
                for (let i = startLine; i <= endLine; i++) {
                    changedLines.push(i);
                }
                // 关键修复：如果是删除/添加行，后续所有行都可能受影响，必须清理缓存
                if (deltaLines !== 0) {
                    for (let i = endLine + 1; i < document.lineCount; i++) {
                        changedLines.push(i);
                    }
                }
                this.cacheManager.clearLineCache(document.uri, changedLines);
                changedLines.forEach(line => resolvedLines.delete(line));

                // 2. 调整行号偏移（覆盖所有后续行）
                if (deltaLines !== 0) {
                    this.cacheManager.adjustLineOffsets(document.uri, endLine, deltaLines);
                    this.adjustResolvedLinesOffset(docKey, resolvedLines, endLine, deltaLines);
                }

                this.resolvedLines.set(docKey, resolvedLines);
                if (LinkProvider.DEBUG_MODE) {
                    console.log(`[LinkProvider] 文本变更：清理行${changedLines.join(',')}，偏移${deltaLines}行`);
                }
            });
        });

        // 2. 文档关闭：清理全量缓存（避免内存泄漏）
        vscode.workspace.onDidCloseTextDocument(document => {
            if (LinkProvider.SUPPORTED_LANGUAGES.has(document.languageId)) {
                const docKey = this.getDocKey(document.uri);
                this.cacheManager.clearDocumentCache(document.uri);
                this.resolvedLines.delete(docKey);
                if (LinkProvider.DEBUG_MODE) {
                    console.log(`[LinkProvider] 文档关闭：清理缓存 ${docKey}`);
                }
            }
        });

        // 3. 文档重命名/移动：清理旧URI缓存
        vscode.workspace.onDidRenameFiles(event => {
            event.files.forEach(file => {
                const fileExt = file.newUri.fsPath.split('.').pop() || '';
                if (fileExt === 'mcfunction') {
                    this.cacheManager.clearOldUriCache(file.oldUri);
                    this.resolvedLines.delete(this.getDocKey(file.oldUri));
                    if (LinkProvider.DEBUG_MODE) {
                        console.log(`[LinkProvider] 文档重命名：清理旧URI ${file.oldUri.fsPath}`);
                    }
                }
            });
        });
    }
            
    



    /** 提供文档链接（优化：仅解析新增可视区域行） */
    async provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentLink[]> {
        // 过滤不支持的文档
        if (!LinkProvider.SUPPORTED_LANGUAGES.has(document.languageId)) { return []; }
        if (!vscode.workspace.workspaceFolders?.length) { return []; }
        // 配置关闭链接则跳过
        if (!DataLoader.getConfig()['file-link-provide']) { return []; }

        const links: vscode.DocumentLink[] = [];
        const docKey = this.getDocKey(document.uri);
        // 初始化“已解析行”集合（增量更新核心标记）
        const resolvedLines = this.resolvedLines.get(docKey) || new Set<number>();

        if (LinkProvider.DEBUG_MODE) {
            console.log(`[LinkProvider] 调用 provideDocumentLinks：文档${docKey}，已解析行${resolvedLines.size}行`);
        }

        // 遍历文档所有行（VS Code 会自动处理渲染，无需手动筛选可视区域）
        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            if (token.isCancellationRequested) { break; } // 响应取消信号

            // 增量逻辑：只处理“未解析”的行（避免重复解析）
            if (resolvedLines.has(lineNumber)) {
                // 已解析行：从缓存读取链接
                const cachedLinks = await this.getCachedLinks(document, lineNumber);
                links.push(...cachedLinks);
                continue;
            }

            // 未解析行：解析并缓存
            try {
                const lineLinks = await this.parseUnresolvedLine(document, lineNumber, resolvedLines);
                links.push(...lineLinks);
                resolvedLines.add(lineNumber); // 标记为已解析
                this.resolvedLines.set(docKey, resolvedLines);
            } catch (err) {
                if (LinkProvider.DEBUG_MODE) {
                    console.error(`[LinkProvider] 解析行${lineNumber}失败`, err);
                }
                resolvedLines.add(lineNumber); // 失败也标记，避免重复报错
                this.resolvedLines.set(docKey, resolvedLines);
            }
        }

        if (LinkProvider.DEBUG_MODE) {
            console.log(`[LinkProvider] 本次返回链接数：${links.length}`);
        }
        return links;
    }

    /** 辅助：从缓存读取已解析行的链接 */
    private async getCachedLinks(document: vscode.TextDocument, lineNumber: number): Promise<vscode.DocumentLink[]> {
        const cachedMeta = this.cacheManager.getMetaCache(document.uri, lineNumber);
        if (!cachedMeta || cachedMeta.length === 0) { return []; }

        const line = document.lineAt(lineNumber);
        const indentOffset = line.firstNonWhitespaceCharacterIndex;
        const links: vscode.DocumentLink[] = [];

        for (const meta of cachedMeta) {
            // 从缓存获取URI（避免重复构建）
            const targetUri = await this.cacheManager.getPathUriCache(meta.path, meta.command);
            if (!targetUri) { continue; }

            // 计算正确的链接范围（确保不越界）
            const startCol = Math.min(indentOffset + meta.tokenStart, line.text.length);
            const endCol = Math.min(indentOffset + meta.tokenEnd, line.text.length);
            const range = new vscode.Range(lineNumber, startCol, lineNumber, endCol);

            // 生成最终链接
            const link = new vscode.DocumentLink(range, targetUri);
            link.tooltip = this.getStrategyByCommand(meta.command)?.getTooltip(meta.path) || '跳转到目标';
            links.push(link);
        }

        return links;
    }

    /** 辅助：解析未解析行并生成链接 */
    private async parseUnresolvedLine(
        document: vscode.TextDocument,
        lineNumber: number,
        resolvedLines: Set<number>
    ): Promise<vscode.DocumentLink[]> {
        const line = document.lineAt(lineNumber);
        const lineText = line.text;
        const indentOffset = line.firstNonWhitespaceCharacterIndex;

        // 跳过空行、注释行
        if (indentOffset === -1 || lineText[indentOffset] === '#') {
            return [];
        }

        // 提取命令文本（忽略字符串内的注释）
        const commandText = this.extractCommandText(lineText);
        if (!commandText) { return []; }

        // 解析令牌并缓存
        let tokens = this.cacheManager.getTokenCache(document.uri, lineNumber);
        if (!tokens) {
            tokens = this.parseTokensWithPosition(commandText);
            this.cacheManager.setTokenCache(document.uri, lineNumber, tokens);
        }
        if (!tokens.length) { return []; }

        // 匹配命令策略
        const matchedStrategy = this.findMatchedStrategy(commandText, tokens);
        if (!matchedStrategy) { return []; }

        // 校验活跃命令
        const activeCommand = this.getActiveCommandInfo(tokens.map(t => t.value));
        if (!activeCommand || !matchedStrategy.validate(tokens.map(t => t.value), activeCommand)) {
            return [];
        }

        // 定位路径令牌并校验
        const commandStartIndex = this.findCommandStartIndex(tokens, matchedStrategy.command);
        if (commandStartIndex === -1) { return []; }
        const pathTokenIndex = matchedStrategy.getPathTokenIndex(commandStartIndex);
        if (pathTokenIndex >= tokens.length) { return []; }
        const pathToken = tokens[pathTokenIndex];
        if (!matchedStrategy.validatePath(pathToken.value)) { return []; }

        // 缓存元数据和URI
        const meta: LinkMetadata = {
            path: pathToken.value,
            command: matchedStrategy.command,
            tokenStart: pathToken.start,
            tokenEnd: pathToken.end
        };
        this.cacheManager.setMetaCache(document.uri, lineNumber, [meta]);
        await this.cacheManager.getPathUriCache(pathToken.value, matchedStrategy.command);

        // 生成最终链接
        const targetUri = await this.cacheManager.getPathUriCache(pathToken.value, matchedStrategy.command);
        if (!targetUri) { return []; }

        const startCol = indentOffset + pathToken.start;
        const endCol = indentOffset + pathToken.end;
        const range = new vscode.Range(lineNumber, startCol, lineNumber, endCol);
        const link = new vscode.DocumentLink(range, targetUri);
        link.tooltip = matchedStrategy.getTooltip(pathToken.value);

        return [link];
    }



    /** 精准提取命令文本（忽略字符串内的#注释） */
    private extractCommandText(lineText: string): string {
        let inQuotes = false;
        for (let i = 0; i < lineText.length; i++) {
            if (lineText[i] === '"') {
                inQuotes = !inQuotes;
            } else if (lineText[i] === '#' && !inQuotes) {
                return lineText.slice(0, i).trim();
            }
        }
        return lineText.trim();
    }

    /** 解析令牌并记录原始位置（避免indexOf反查误差） */
    private parseTokensWithPosition(commandText: string): TokenWithPosition[] {
        const tokens: TokenWithPosition[] = [];
        const regex = /(".*?"|\S+)/g; // 匹配带引号的字符串或非空字符
        let match: RegExpExecArray | null;

        while ((match = regex.exec(commandText)) !== null) {
            const value = match[1].replace(/^"|"$/g, ''); // 去除引号
            tokens.push({
                value,
                start: match.index,
                end: match.index + match[1].length
            });
        }

        return tokens;
    }

    /** 查找匹配的命令策略（优化查找效率） */
    private findMatchedStrategy(commandText: string, tokens: TokenWithPosition[]): CommandLinkStrategy | undefined {
        if (!tokens.length) {return undefined;}

        // 优先匹配命令前缀（O(1)）
        const firstToken = tokens[0].value.toLowerCase();
        if (this.commandStrategies.has(firstToken)) {
            return this.commandStrategies.get(firstToken);
        }

        // 正则匹配（仅当前缀不匹配时）
        for (const strategy of this.commandStrategies.values()) {
            if (strategy.matchRegex.test(commandText)) {
                return strategy;
            }
        }

        return undefined;
    }

    /** 获取活跃命令信息（增强异常捕获） */
    private getActiveCommandInfo(tokens: string[]): ActiveCommandInfo | null {
        try {
            const activeCommand = MainCompletionProvider.instance?.findActiveCommand(tokens);
            if (!activeCommand) {return null;}

            return {
                currentCommands: activeCommand.currentCommands || [],
                isExecute: activeCommand.isExecute || false,
                isComplete: activeCommand.isComplete || false
            };
        } catch (err) {
            if (LinkProvider.DEBUG_MODE) {
                console.error('获取活跃命令失败', err);
            }
            return null;
        }
    }

    /** 查找命令在令牌数组中的起始索引 */
    private findCommandStartIndex(tokens: TokenWithPosition[], command: string): number {
        const lowerCommand = command.toLowerCase();
        return tokens.findIndex(token => token.value.toLowerCase() === lowerCommand);
    }

    /** 根据命令名获取策略 */
    public getStrategyByCommand(command: string): CommandLinkStrategy | undefined {
        return this.commandStrategies.get(command.toLowerCase());
    }

    /** 生成文档键（复用缓存管理器的逻辑） */
    private getDocKey(uri: vscode.Uri): string {
        return uri.fsPath;
    }

    /** 调整已解析行号偏移（同步缓存行号变化） */
    private adjustResolvedLinesOffset(
        docKey: string,
        resolvedLines: Set<number>,
        changeEndLine: number,
        deltaLines: number
    ): void {
        if (deltaLines === 0) {return;}

        const affectedLines = Array.from(resolvedLines).filter(line => line > changeEndLine);
        affectedLines.forEach(line => resolvedLines.delete(line));
        affectedLines.forEach(line => resolvedLines.add(line + deltaLines));
        this.resolvedLines.set(docKey, resolvedLines);
    }

    /** 销毁提供器（插件卸载时） */
    public dispose(): void {
        this.cacheManager.dispose();
        this.resolvedLines.clear();
        if (this.debounceTimer) {clearTimeout(this.debounceTimer);}
    }
}
/** LRU缓存工具类（保障缓存不膨胀，修复clear方法和类型问题） */
export class LRUCache<K, V> {
    private cache = new Map<K, V>();
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value) {
            // 访问后移到队尾（标记为最近使用）
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // 修复：添加类型校验，避免undefined赋值给K
            const oldestKeyResult = this.cache.keys().next();
            if (!oldestKeyResult.done) {
                const oldestKey = oldestKeyResult.value;
                this.cache.delete(oldestKey);
            }
        }
        this.cache.set(key, value);
    }

    delete(key: K): void {
        this.cache.delete(key);
    }

    forEach(callback: (value: V, key: K) => void): void {
        this.cache.forEach(callback);
    }

    get size(): number {
        return this.cache.size;
    }

    // 修复：添加clear方法
    clear(): void {
        this.cache.clear();
    }
}