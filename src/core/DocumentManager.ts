import * as vscode from 'vscode';
import { MainCompletionProvider } from './MainCompletionProvider';

// 每行解析结果的缓存结构
interface LineParseResult {
    commandSegments: string[]; // 命令片段（如split后的结果）
    lastParsed: number; // 最后解析时间戳（用于过期清理）
}

// 文档缓存结构
interface DocumentCache {
    uri: vscode.Uri; // 文档唯一标识
    lineCache: Map<number, LineParseResult>; // 行号 -> 解析结果
    lastAccessed: number; // 最后访问时间（用于缓存淘汰）
}

export class DocumentManager {
    // 全局单例实例
    private static instance: DocumentManager;

    // 文档缓存池（按文档URI字符串索引）
    private documentCache: Map<string, DocumentCache> = new Map();

    // 配置参数
    private static readonly MAX_CACHE_LINES_PER_DOC = 400; // 单文档最大缓存行数
    private static readonly CACHE_EXPIRE_TIME = 3 * 60 * 1000; // 缓存过期时间（3分钟）
    private static readonly MAX_DOCUMENTS_CACHED = 20; // 最大缓存文档数


    private constructor() {
        this.initEventListeners();
        this.startCacheCleaner();
    }

    // 单例模式获取实例
    public static getInstance(): DocumentManager {
        if (!DocumentManager.instance) {
            DocumentManager.instance = new DocumentManager();
        }
        return DocumentManager.instance;
    }

    // 初始化文档事件监听
    private initEventListeners() {
        // 文档内容变更时，延迟清理对应行的缓存
        vscode.workspace.onDidChangeTextDocument(event => {
            const uriStr = event.document.uri.toString();
            if (!this.documentCache.has(uriStr)) {return;};

            this.handleDocumentChanges(event);
        });

        // 文档关闭时，清理整个文档的缓存
        vscode.workspace.onDidCloseTextDocument(document => {
            const uriStr = document.uri.toString();
            this.documentCache.delete(uriStr);
        });
    }

    // 定时清理过期缓存
    private startCacheCleaner() {
        // 每10分钟执行一次缓存清理
        setInterval(() => {
            const now = Date.now();
            const expiredUris: string[] = [];

            // 清理过期文档缓存
            this.documentCache.forEach((cache, uriStr) => {
                if (now - cache.lastAccessed > DocumentManager.CACHE_EXPIRE_TIME) {
                    expiredUris.push(uriStr);
                } else {
                    // 清理文档内过期的行缓存
                    cache.lineCache.forEach((result, line) => {
                        if (now - result.lastParsed > DocumentManager.CACHE_EXPIRE_TIME) {
                            cache.lineCache.delete(line);
                        }
                    });
                }
            });

            expiredUris.forEach(uriStr => this.documentCache.delete(uriStr));

            // 超出最大缓存文档数时，按访问时间淘汰最旧的
            if (this.documentCache.size > DocumentManager.MAX_DOCUMENTS_CACHED) {
                const sortedUris = Array.from(this.documentCache.entries())
                    .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)
                    .map(([uriStr]) => uriStr);

                // 只保留最新的MAX_DOCUMENTS_CACHED个
                sortedUris.slice(0, -DocumentManager.MAX_DOCUMENTS_CACHED)
                    .forEach(uriStr => this.documentCache.delete(uriStr));
            }
        }, 10 * 60 * 1000);
    }

    // 处理文档内容变更，清理受影响行的缓存
    private handleDocumentChanges(event: vscode.TextDocumentChangeEvent) {
        const uriStr = event.document.uri.toString();
        const cache = this.documentCache.get(uriStr);
        if (!cache) {return;}

        // 遍历所有变更范围，清理对应行的缓存
        event.contentChanges.forEach(change => {
            const startLine = change.range.start.line;
            const endLine = change.range.end.line;

            // 对于多行变更，清理所有涉及的行
            for (let line = startLine; line <= endLine; line++) {
                cache.lineCache.delete(line);
            }
        });

        // 更新文档最后访问时间
        cache.lastAccessed = Date.now();
    }

    // 获取文档中指定行的命令片段（核心方法：统一解析入口）
    public getCommandSegments(document: vscode.TextDocument, lineNumber: number): string[] {
        const uriStr = document.uri.toString();
        let cache = this.documentCache.get(uriStr);

        // 初始化文档缓存（如果不存在）
        if (!cache) {
            cache = {
                uri: document.uri,
                lineCache: new Map(),
                lastAccessed: Date.now()
            };
            this.documentCache.set(uriStr, cache);
        }

        // 检查行缓存是否存在，存在则直接返回
        const lineCache = cache.lineCache.get(lineNumber);
        if (lineCache) {
            cache.lastAccessed = Date.now(); // 更新访问时间
            // console.log("缓存命中");
            return lineCache.commandSegments;
        }

        // 缓存未命中，执行解析（复用原有解析逻辑）
        const lineText = document.lineAt(lineNumber).text;
        const commandSegments = MainCompletionProvider.instance.extractCommand(lineText);

        // 限制单文档缓存行数，避免过大
        if (cache.lineCache.size >= DocumentManager.MAX_CACHE_LINES_PER_DOC) {
            // 淘汰最早解析的行
            const oldestLine = Array.from(cache.lineCache.keys()).sort((a, b) => a - b)[0];
            cache.lineCache.delete(oldestLine);
        }

        // 存入缓存
        cache.lineCache.set(lineNumber, {
            commandSegments,
            lastParsed: Date.now()
        });
        cache.lastAccessed = Date.now();

        return [...commandSegments];
    }

    // 手动清理指定文档的缓存（用于特殊场景）
    public clearDocumentCache(uri: vscode.Uri) {
        this.documentCache.delete(uri.toString());
    }
}
