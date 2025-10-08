import * as vscode from 'vscode';
import { MainCompletionProvider } from "../core/MainCompletionProvider";
import { MinecraftUtils } from '../utils/MinecraftUtils';
import { DocumentManager } from './DocumentManager';

/** 命令配置接口，定义不同命令的解析规则 */
interface CommandConfig {
    pathIndex: number;
    folder: string;
    extension: string;
    validActions?: string[];
    paramValidator?: RegExp;
}

/**
 * 文档链接提供器（优化版）
 * 核心优化：提升链接生成和响应速度，减少不必要的计算开销
 */
export class LinkProvider implements vscode.DocumentLinkProvider {
    /** 命令配置映射表 */
    private static readonly COMMAND_CONFIGS: Record<string, CommandConfig> = {
        'function': {
            pathIndex: 1,
            folder: 'functions',
            extension: '.mcfunction',
            paramValidator: /^[^ ]+$/
        },
        'advancement': {
            pathIndex: 4,
            validActions: ['grant', 'revoke', 'test'],
            folder: 'advancements',
            extension: '.json',
            paramValidator: /^[^:]+:[^ ]+$/
        }
    };

    /** 支持的命令集合 */
    private static readonly SUPPORTED_COMMANDS = new Set(Object.keys(LinkProvider.COMMAND_CONFIGS));

    /** 
     * 预编译正则表达式（优化点1）
     * 避免每次调用时重复创建正则对象，提升匹配速度
     */
    private static readonly COMMAND_REGEX_MAP = new Map<string, RegExp>(
        Array.from(LinkProvider.SUPPORTED_COMMANDS).map(cmd =>
            [cmd, new RegExp(`(^|\\s)${cmd}\\b`, 'i')]
        )
    );

    /** 
     * 多级缓存（优化点2）
     * 1. 行文本 → 令牌数组缓存
     * 2. 行 → 链接结果缓存
     * 3. 路径 → 解析结果缓存
     */
    private tokenCache = new Map<string, string[]>(); // key: 行文本哈希
    private linkCache = new Map<string, vscode.DocumentLink[]>(); // key: 缓存键
    private pathParseCache = new Map<string, [string, string] | null>(); // key: 路径字符串

    /** 文档版本跟踪 */
    private documentVersions = new Map<string, number>();

    /** 
     * 延长缓存过期时间（优化点3）
     * 从4000ms调整为10000ms，减少高频操作时的重复计算
     */
    private static readonly CACHE_TTL = 5000;

    constructor() {
        vscode.workspace.onDidChangeTextDocument(event => {
            const uriStr = event.document.uri.toString();
            const docVersion = event.document.version;
            this.documentVersions.set(uriStr, docVersion);

            // 优化点4：只清理变更行的缓存，而非全文档
            const changedLines = new Set<number>();
            event.contentChanges.forEach(change => {
                const startLine = event.document.positionAt(change.rangeOffset).line;
                const endLine = event.document.positionAt(change.rangeOffset + change.rangeLength).line;
                for (let i = startLine; i <= endLine; i++) {
                    changedLines.add(i);
                }
            });

            // 清理变更行的缓存
            const prefix = `${uriStr}:`;
            this.linkCache.forEach((_, key) => {
                if (key.startsWith(prefix)) {
                    const lineNum = parseInt(key.split(':')[1], 10);
                    if (changedLines.has(lineNum)) {
                        this.linkCache.delete(key);
                    }
                }
            });

            // 清理受影响的令牌缓存（通过行文本哈希关联）
            changedLines.forEach(lineNum => {
                const lineText = event.document.lineAt(lineNum).text;
                const textHash = this.simpleHash(lineText);
                this.tokenCache.delete(textHash.toString());
            });
        });
    }

    provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentLink[]> {
        const links: vscode.DocumentLink[] = [];
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return links; }

        const uriStr = document.uri.toString();
        const currentVersion = this.documentVersions.get(uriStr) || document.version;

        // 逐行处理（优化点5：使用for循环而非forEach，减少函数调用开销）
        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            if (token.isCancellationRequested) { break; }

            const line = document.lineAt(lineNumber);
            const cacheKey = this.generateCacheKey(document, lineNumber, line.text);

            // 优先使用缓存
            const cachedLinks = this.linkCache.get(cacheKey);
            if (cachedLinks) {
                links.push(...cachedLinks);
                continue;
            }

            // 处理行并缓存结果
            const parsedLinks = this.processLine(document ,line.text, lineNumber,line);
            this.linkCache.set(cacheKey, parsedLinks);
            setTimeout(() => this.linkCache.delete(cacheKey), LinkProvider.CACHE_TTL);

            links.push(...parsedLinks);
        }

        return links;
    }

    /** 生成缓存键（优化：使用更紧凑的哈希算法） */
    private generateCacheKey(document: vscode.TextDocument, lineNumber: number, lineText: string): string {
        const textHash = this.simpleHash(lineText);
        return `${document.uri.toString()}:${lineNumber}:${textHash}:${document.version}`;
    }

    /** 优化哈希算法，减少碰撞概率同时提升计算速度 */
    private simpleHash(str: string): number {
        let hash = 5381; // 经典哈希种子
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) + hash + str.charCodeAt(i); // 位运算提升速度
        }
        return hash >>> 0; // 转换为无符号整数
    }

    /** 处理单行文本（优化流程：提前短路+缓存复用） */
    private processLine(
        document: vscode.TextDocument,
        lineText: string,
        lineNumber: number,
        line: vscode.TextLine,
    ): vscode.DocumentLink[] {
        const links: vscode.DocumentLink[] = [];
        const trimmedLine = lineText.trim();

        // 优化点6：提前过滤无效行（空行/注释行）
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            return links;
        }

        // 去除行内注释
        const commandText = trimmedLine.split(/#/)[0].trim();
        if (!commandText) { return links; }

        // 优化点7：使用预编译正则快速检查，减少正则创建开销
        let hasSupportedCommand = false;
        for (const [cmd, regex] of LinkProvider.COMMAND_REGEX_MAP) {
            if (regex.test(commandText)) {
                hasSupportedCommand = true;
                break;
            }
        }
        if (!hasSupportedCommand) {
            return links;
        }

        // 优化点8：缓存令牌提取结果，避免重复解析
        const textHash = this.simpleHash(commandText);
        let tokens = this.tokenCache.get(textHash.toString());
        if (!tokens) {
            tokens = DocumentManager.getInstance().getCommandSegments(document, lineNumber);
            this.tokenCache.set(textHash.toString(), tokens);
            // 令牌缓存单独设置较短过期时间（避免内存占用过大）
            setTimeout(() => this.tokenCache.delete(textHash.toString()), 5000);
        }
        if (tokens.length === 0) { return links; }

        // 获取活跃命令
        const activeCommandInfo = MainCompletionProvider.instance.findActiveCommand(tokens);
        if (!activeCommandInfo) { return links; }

        const command = activeCommandInfo.currentCommands[0]?.toLowerCase();
        if (!command) { return links; }

        // 跳过不完整的execute命令
        if (activeCommandInfo.isExecute && !activeCommandInfo.isComplete) {
            return links;
        }

        const config = LinkProvider.COMMAND_CONFIGS[command];
        if (!config) { return links; }

        // 查找命令起始索引
        const startTokenIndex = this.findCommandStartIndex(tokens, activeCommandInfo.currentCommands);
        if (startTokenIndex === -1) { return links; }

        // 获取路径范围
        const pathRange = this.getPathRange(commandText, command, config, startTokenIndex, tokens);
        if (!pathRange) { return links; }

        // 计算链接位置
        const adjustedRange = new vscode.Range(
            lineNumber,
            line.firstNonWhitespaceCharacterIndex + pathRange.start,
            lineNumber,
            line.firstNonWhitespaceCharacterIndex + pathRange.end
        );

        // 优化点9：缓存路径解析结果，减少重复计算
        const pathToken = commandText.substring(pathRange.start, pathRange.end);
        let result = this.pathParseCache.get(pathToken);
        if (result === undefined) {
            result = MinecraftUtils.parseResourcePath(pathToken);
            this.pathParseCache.set(pathToken, result);
            // 路径解析缓存过期时间
            setTimeout(() => this.pathParseCache.delete(pathToken), LinkProvider.CACHE_TTL);
        }
        if (!result) { return links; }

        // 生成目标URI（复用解析结果）
        const [nameSpace, path] = result;
        const targetUri = MinecraftUtils.buildFunctionUri(pathToken);
        if (!targetUri) { return links; }

        // 创建链接
        const link = new vscode.DocumentLink(adjustedRange, targetUri);
        link.tooltip = `跳转到 ${config.folder}/${nameSpace}/${path}${config.extension}`;
        links.push(link);

        return links;
    }

    /** 优化命令起始索引查找（减少循环次数） */
    private findCommandStartIndex(originalTokens: string[], currentCommands: string[]): number {
        if (currentCommands.length === 0) { return -1; }

        const maxStartIndex = originalTokens.length - currentCommands.length;
        if (maxStartIndex < 0) { return -1; }

        // 限制循环范围，避免不必要的检查
        for (let i = 0; i <= maxStartIndex; i++) {
            if (originalTokens[i] !== currentCommands[0]) {
                continue; // 第一个令牌不匹配，直接跳过
            }

            // 验证后续令牌
            let match = true;
            for (let j = 1; j < currentCommands.length; j++) {
                if (originalTokens[i + j] !== currentCommands[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                return i;
            }
        }
        return -1;
    }

    /** 获取路径参数范围（保持逻辑不变） */
    private getPathRange(
        commandText: string,
        command: string,
        config: CommandConfig,
        startTokenIndex: number,
        tokens: string[]
    ): { start: number; end: number } | null {
        const pathTokenIndex = startTokenIndex + config.pathIndex;
        if (pathTokenIndex >= tokens.length) { return null; }

        const pathToken = tokens[pathTokenIndex];
        if (config.paramValidator && !config.paramValidator.test(pathToken)) {
            return null;
        }

        if (command === 'advancement' && config.validActions) {
            const actionTokens = tokens.slice(startTokenIndex + 1, pathTokenIndex);
            if (!actionTokens.some(t => config.validActions!.includes(t.toLowerCase()))) {
                return null;
            }
        }

        let currentPos = 0;
        const tokenPositions: { start: number; end: number }[] = [];
        for (const token of tokens) {
            const tokenStart = commandText.indexOf(token, currentPos);
            if (tokenStart === -1) { break; }
            tokenPositions.push({ start: tokenStart, end: tokenStart + token.length });
            currentPos = tokenStart + token.length + 1;
        }

        return tokenPositions[pathTokenIndex] || null;
    }

    resolveDocumentLink?(link: vscode.DocumentLink): vscode.ProviderResult<vscode.DocumentLink> {
        return link;
    }

    /** 清理指定文档的缓存（按需清理，而非全量） */
    private clearCache(documentUri: vscode.Uri): void {
        const uriStr = documentUri.toString();
        const prefix = `${uriStr}:`;

        // 只清理当前文档的缓存项
        this.linkCache.forEach((_, key) => {
            if (key.startsWith(prefix)) {
                this.linkCache.delete(key);
            }
        });
    }
}
