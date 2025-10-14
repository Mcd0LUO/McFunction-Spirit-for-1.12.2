import * as vscode from 'vscode';
import { DocumentManager } from '../core/DocumentManager';
import { JsonMessageUtils } from '../utils/JsonMessageUtils';
import { MainCompletionProvider } from '../core/MainCompletionProvider';
import { ColorCode, FormatCode, StyleCode, LINE_BREAK, OBFUSCATED_SYMBOL } from '../utils/JsonMessageUtils';
import { DataLoader } from '../core/DataLoader';
import { CommandsInfo } from '../core/CommandCompletionProvider';
import { MinecraftUtils } from '../utils/MinecraftUtils';
import { FileLineIdleSearchProcessor } from '../core/FileLineIdleSearchProcessor';
// 引入与LinePreviewManager一致的类型定义


export class LineHoverManager {
    private disposable: vscode.Disposable;
    private styleCodes = {
        'l': 'bold', 'm': 'strikethrough', 'n': 'underline',
        'o': 'italic', 'r': 'reset', 'k': 'obfuscated'
    } as Record<StyleCode, string>;

    static instance: LineHoverManager | undefined;
    static getInstance() {
        if (!LineHoverManager.instance) {
            LineHoverManager.instance = new LineHoverManager();
        }
        return LineHoverManager.instance;
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        if (DataLoader.getConfig()['json-message-hover-preview'] === false) { return; }
        const originCommands = DocumentManager.getInstance().getCommandSegments(document, position.line);
        const commands = MainCompletionProvider.instance.findActiveCommand(originCommands);
        if (commands.currentCommands[0] === 'tellraw' || commands.currentCommands[0] === 'title') {
            return this.provideJsonMessageHover(document, position, commands);
        }
        if (commands.currentCommands[0] === 'function') {
            return this.provideFunctionHover(document, position, commands);
        }
        if (commands.currentCommands[0] === 'scoreboard') {
            return this.provideScoreboardHover(document, position, commands);
        }


    }

    /**
     * 转换为带样式的Markdown（修复空格渲染问题）
     */
    private parseToMarkdown(components: Array<{
        text: string,
        bold?: boolean,
        italic?: boolean,
        underlined?: boolean,
        strikethrough?: boolean
    }>): string {
        let markdown = '';

        components.forEach(component => {
            let currentStyle = {
                bold: component.bold || false,
                italic: component.italic || false,
                underlined: component.underlined || false,
                strikethrough: component.strikethrough || false
            };

            let currentSegment = '';
            let replaceNextChar = false;
            const text = component.text || '';

            for (let i = 0; i < text.length; i++) {
                if (text[i] === LINE_BREAK.charAt(0)) {
                    currentSegment = this.wrapWithStyles(currentSegment, currentStyle);
                    markdown += currentSegment + '<br>';
                    currentSegment = '';
                    continue;
                }

                if (text[i] === '§' && i + 1 < text.length) {
                    if (currentSegment) {
                        markdown += this.wrapWithStyles(currentSegment, currentStyle);
                        currentSegment = '';
                    }

                    const code = text[i + 1].toLowerCase() as StyleCode;
                    i++;

                    switch (this.styleCodes[code]) {
                        case 'bold': currentStyle.bold = true; break;
                        case 'strikethrough': currentStyle.strikethrough = true; break;
                        case 'underline': currentStyle.underlined = true; break;
                        case 'italic': currentStyle.italic = true; break;
                        case 'obfuscated': replaceNextChar = true; break;
                        case 'reset':
                            currentStyle = { bold: false, italic: false, underlined: false, strikethrough: false };
                            break;
                    }
                } else {
                    currentSegment += replaceNextChar
                        ? OBFUSCATED_SYMBOL
                        : text[i];
                    replaceNextChar = false;
                }
            }

            if (currentSegment) {
                markdown += this.wrapWithStyles(currentSegment, currentStyle);
            }
        });

        return markdown;
    }

    /**
     * 应用样式包装文本（关键：将空格替换为&nbsp;保留连续空格）
     */
    private wrapWithStyles(text: string, style: {
        bold: boolean,
        italic: boolean,
        underlined: boolean,
        strikethrough: boolean
    }): string {
        // 1. 先将普通空格替换为非换行空格（解决Markdown合并空格问题）
        // 注意：只替换半角空格，保留其他空白字符（如制表符）
        let processedText = text.replace(/ /g, '&nbsp;');

        // 2. 转义Markdown特殊字符
        processedText = processedText
            .replace(/\*/g, '\\*')
            .replace(/_/g, '\\_')
            .replace(/~/g, '\\~')
            .replace(/`/g, '\\`');

        // 3. 应用文本样式标签
        let wrapped = processedText;
        if (style.strikethrough) {wrapped = `~~${wrapped}~~`;}
        if (style.italic) {wrapped = `*${wrapped}*`;}
        if (style.bold) {wrapped = `**${wrapped}**`;}
        if (style.underlined) {wrapped = `<u>${wrapped}</u>`;}

        return wrapped;
    }

    private isStyleCode(code: string): code is StyleCode {
        return ['l', 'm', 'n', 'o', 'r', 'k'].includes(code);
    }

    private constructor() {
        this.disposable = vscode.languages.registerHoverProvider(
            { scheme: 'file', language: 'mcfunction' },
            this
        );
    }

    private provideFunctionHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        commands: CommandsInfo
    ): vscode.Hover {
        // 1. 前置校验：仅处理 "function 函数名" 格式的命令（至少2个片段：命令名+函数名）
        if (!commands.currentCommands ||
            commands.currentCommands[0] !== 'function' ||
            commands.currentCommands.length < 2
        ) {
            return new vscode.Hover(""); // 不符合格式，返回空Hover
        }

        try {
            if (!FileLineIdleSearchProcessor.isScanCompleted) { return new vscode.Hover("⚠️ 函数索引未完成，请稍后再试");}
            // 2. 获取目标函数的引用缓存（referencedFunctions：URI → 行号数组）
            // 注：假设 getFunctionRefferences 返回的是该函数被引用的所有位置（Map<vscode.Uri, number[]>）
            const functionReferences = DocumentManager.getInstance().getFunctionRefferences(commands.currentCommands[1]);

            // 3. 处理缓存为空的情况
            if (!functionReferences || functionReferences.size === 0) {
                const emptyTip = new vscode.MarkdownString("⚠️ 未找到该函数的引用位置");
                emptyTip.isTrusted = true;
                return new vscode.Hover(emptyTip);
            }

            // 4. 初始化Markdown格式化对象（isTrusted=true才能渲染链接/格式）
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;

            // 5. 组装Hover标题
            markdown.appendMarkdown(`### 🔍 函数引用位置（共 ${functionReferences.size} 个文件）\n`);
            markdown.appendMarkdown("---\n"); // 分隔线，提升可读性

            // 6. 遍历引用缓存，解析并格式化每个引用位置
            functionReferences.forEach((lineNumbers, targetUri) => {
                try {
                    // 6.1 解码URI路径（处理中文/特殊字符转码问题）
                    const parseResult = MinecraftUtils.parseResourceUri(targetUri);
                    
                    // 检查解析结果是否有效
                    if (!parseResult) {
                        markdown.appendMarkdown(`- ⚠️ 无法解析的引用文件（URI错误）\n`);
                        return;
                    }
                    
                    const [namespace, func] = parseResult;
                    // 6.2 生成可点击的文件路径（VS Code支持 "file://" 链接跳转）
                    const fileLink = `[${namespace}:${func}](${targetUri})`;

                    // 6.3 处理行号：排序+去重+格式化为列表（如 "第 5, 8, 12 行"）
                    const sortedLines = [...new Set(lineNumbers)].sort((a, b) => a - b); // 去重+升序
                    const lineText = sortedLines.length > 1
                        ? `第 ${sortedLines.join("、") } 行`
                        : `第 ${sortedLines[0]} 行`;

                    // 6.4 拼接当前文件的引用信息（一行一个文件，带缩进）
                    markdown.appendMarkdown(`- 📄 ${fileLink}\n  → ${lineText}\n`);
                } catch (uriError) {
                    // 异常处理：避免单个URI解析失败导致整个Hover失效
                    markdown.appendMarkdown(`- ⚠️ 无法解析的引用文件（URI错误）\n`);
                    console.error("解析函数引用URI失败：", uriError);
                }
            });

            // 7. 补充hover说明（可选）
            markdown.appendMarkdown("---\n");
            markdown.appendMarkdown("> 点击文件路径可直接跳转至引用位置");

            // 8. 返回格式化后的Hover
            return new vscode.Hover(markdown);

        } catch (error) {
            // 全局异常捕获：避免代码报错导致Hover无响应
            const errorTip = new vscode.MarkdownString("⚠️ 解析函数引用失败，请检查函数名是否正确");
            errorTip.isTrusted = true;
            return new vscode.Hover(errorTip);
        }
    }

    private provideJsonMessageHover(document: vscode.TextDocument, position: vscode.Position, commands: CommandsInfo): vscode.Hover {
        if (!commands.currentCommands || !["tellraw", "title"].includes(commands.currentCommands[0])) {
            return new vscode.Hover("");
        }

        try {
            const jsonIndex = commands.currentCommands[0] === 'tellraw' ? 2 : 3;
            const jsonObj = JSON.parse(commands.currentCommands[jsonIndex]);
            const components = Array.isArray(jsonObj) ? jsonObj : [jsonObj];
            const normalizedComponents = JsonMessageUtils.getInstance().normalizeComponents(components);

            const formattedContent = this.parseToMarkdown(normalizedComponents);
            const markdown = new vscode.MarkdownString(formattedContent);
            markdown.isTrusted = true;
            markdown.supportHtml = true;

            return new vscode.Hover(markdown);
        } catch (error) {
            return new vscode.Hover('⚠️ 无法解析JSON格式内容');
        }
    }

    private provideScoreboardHover(document: vscode.TextDocument, position: vscode.Position, commands: CommandsInfo): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        if (commands.currentCommands.length <= 4) {
            return new vscode.Hover("");
        }
        // 获取当前光标所在文本
        const select =  document.getText(document.getWordRangeAtPosition(position));
        // 获取光标所在文本可能在的命令commands索引中
        const index = this.caculateIndexInCommands(commands.currentCommands, select);
        if (index === undefined) {
            return new vscode.Hover("");
        }
        // 尝试获取记分板定义函数uri
        const scoreboard = FileLineIdleSearchProcessor.SCOREBOARDS.get(commands.currentCommands[index]);
        if (!scoreboard) {
            return new vscode.Hover("");
        }
        const oriUri = scoreboard[2];
        markdown.appendMarkdown(`### 🔍 记分板定义位置\n`);
        markdown.appendMarkdown(`[${MinecraftUtils.buildFunctionCallByUri(oriUri)}](${oriUri})`);
        return new vscode.Hover(markdown);
    }

    private caculateIndexInCommands(commands: string[], part: string): number {
        // 如果part包含在
        return commands.findIndex(cmd => cmd.includes(part));
    }

    dispose() {
        LineHoverManager.instance = undefined;
        this.disposable.dispose();
    }
}

