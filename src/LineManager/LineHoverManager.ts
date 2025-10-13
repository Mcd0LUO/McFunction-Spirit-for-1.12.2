import * as vscode from 'vscode';
import { DocumentManager } from '../core/DocumentManager';
import { JsonMessageUtils } from '../utils/JsonMessageUtils';
import { MainCompletionProvider } from '../core/MainCompletionProvider';
import { ColorCode, FormatCode, StyleCode, LINE_BREAK, OBFUSCATED_SYMBOL } from '../utils/JsonMessageUtils';
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
        const originCommands = DocumentManager.getInstance().getCommandSegments(document, position.line);
        const commands = MainCompletionProvider.instance.findActiveCommand(originCommands);

        if (!commands.currentCommands || !["tellraw", "title"].includes(commands.currentCommands[0])) {
            return;
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

    dispose() {
        LineHoverManager.instance = undefined;
        this.disposable.dispose();
    }
}

