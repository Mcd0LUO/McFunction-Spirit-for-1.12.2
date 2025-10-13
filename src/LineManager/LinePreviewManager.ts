import * as vscode from 'vscode';
import { MainCompletionProvider } from '../core/MainCompletionProvider';
import { DocumentManager } from '../core/DocumentManager';
import { JsonMessageUtils } from '../utils/JsonMessageUtils';
import { ColorCode, StyleCode, FormatCode, LINE_BREAK, OBFUSCATED_SYMBOL } from '../utils/JsonMessageUtils';

/**
 * 防抖延迟时间（毫秒）
 */
const DEBOUNCE_DELAY = 100;

/**
 * 样式化文本片段接口
 * 用于表示具有特定格式的文本段落
 */
interface StyledFragment {
    /**
     * 文本内容
     */
    text: string;

    /**
     * 文本颜色
     */
    color?: string;

    /**
     * 是否加粗
     */
    bold: boolean;

    /**
     * 是否斜体
     */
    italic: boolean;

    /**
     * 是否下划线
     */
    underlined: boolean;

    /**
     * 是否删除线
     */
    strikethrough: boolean;

    /**
     * 是否为内部片段（不是第一个）
     */
    isInner: boolean;

    /**
     * 所在行偏移量
     */
    line: number;
}

/**
 * 行预览管理器类
 * 负责在编辑器中实时预览tellraw和title命令的显示效果
 */
export class LinePreviewManager implements vscode.Disposable {
    /**
     * 装饰器集合，用于管理创建的文本装饰
     */
    private decorations: Map<string, vscode.TextEditorDecorationType> = new Map();

    /**
     * 可释放资源集合，用于插件销毁时清理资源
     */
    private disposables: vscode.Disposable[] = [];

    /**
     * 防抖定时器，用于控制预览更新频率
     */
    private debounceTimer: NodeJS.Timeout | null = null;

    /**
     * Minecraft格式代码映射表
     * 包含颜色代码和样式代码的映射关系
     */
    private formatCodes = {
        /**
         * 颜色代码映射表
         * 将Minecraft颜色代码映射为对应的HEX颜色值
         */
        color: {
            '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
            '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
            '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
            'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
        } as Record<ColorCode, string>,

        /**
         * 样式代码映射表
         * 将Minecraft样式代码映射为对应的样式名称
         */
        style: {
            'l': 'bold', 'm': 'strikethrough', 'n': 'underline',
            'o': 'italic', 'r': 'reset', 'k': 'obfuscated'
        } as Record<StyleCode, string>
    };

    /**
     * 构造函数
     * 初始化行预览管理器，设置事件监听器
     */
    constructor() {
        // 创建防抖更新函数
        const debouncedUpdate = this.debounce(this.updatePreview.bind(this), DEBOUNCE_DELAY);

        // 注册事件监听器
        this.disposables.push(
            // 光标位置改变事件
            vscode.window.onDidChangeTextEditorSelection(debouncedUpdate),
            // 活动编辑器改变事件
            vscode.window.onDidChangeActiveTextEditor(debouncedUpdate),
            // 文档内容改变事件
            vscode.workspace.onDidChangeTextDocument(debouncedUpdate)
        );

        // 立即更新一次预览
        this.updatePreview();
    }

    /**
     * 防抖函数实现
     * 用于限制函数执行频率，避免频繁触发更新
     * @param func 需要防抖的函数
     * @param delay 延迟时间（毫秒）
     * @returns 防抖后的函数
     */
    private debounce<T extends (...args: any[]) => void>(func: T, delay: number): T {
        return ((...args: any[]) => {
            // 清除之前的定时器
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }
            // 设置新的定时器
            this.debounceTimer = setTimeout(() => {
                func(...args);
                this.debounceTimer = null;
            }, delay);
        }) as unknown as T;
    }

    /**
     * 更新预览内容
     * 主要的预览逻辑处理函数
     */
    private updatePreview() {
        // 获取当前活动的文本编辑器
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        // 清除现有的装饰
        this.clearDecorations();

        // 获取光标所在行的信息
        const cursorLine = editor.selection.active.line;

        // 使用主补全提供者解析命令
        const commands = DocumentManager.getInstance().getCommandSegments(editor.document, cursorLine);
        if (commands.length === 0) { return; }

        // 查找当前活跃的命令
        const activeCommand = MainCompletionProvider.instance.findActiveCommand(commands);

        // 检查是否为支持的命令(tellraw或title)
        if (!this.isSupportedCommand(activeCommand.currentCommands[0])) {
            return;
        }

        let jsonPart = '';
        // 根据命令类型提取JSON部分
        if (activeCommand.currentCommands[0] === 'tellraw' && activeCommand.currentCommands.length > 2) {
            jsonPart = activeCommand.currentCommands[2];
        }
        else if (activeCommand.currentCommands[0] === 'title' && activeCommand.currentCommands.length > 3) {
            jsonPart = activeCommand.currentCommands[3];
        }
        else { return; }

        // 如果没有JSON部分，显示警告装饰
        if (!jsonPart) {
            this.showWarningDecoration(editor, cursorLine);
            return;
        }

        // 尝试解析JSON并应用装饰
        try {
            const textComponents = JSON.parse(jsonPart);
            const components = Array.isArray(textComponents) ? textComponents : [textComponents];
            const normalizedComponents = JsonMessageUtils.getInstance().normalizeComponents(components);
            const styledFragments = this.parseFormatCodes(normalizedComponents);
            this.applyComponentDecorations(editor, cursorLine, styledFragments);
        } catch (error) {
            // 解析失败时显示警告装饰
            this.showWarningDecoration(editor, cursorLine);
        }
    }

    /**
     * 检查命令是否受支持
     * @param command 命令名称
     * @returns 是否为支持的命令
     */
    private isSupportedCommand(command: string): boolean {
        return command === 'tellraw' || command === 'title';
    }

    /**
     * 解析格式代码
     * 将带有Minecraft格式代码的文本解析为样式化的片段
     * @param components 标准化后的组件数组
     * @returns 样式化片段数组
     */
    private parseFormatCodes(components: Array<{ text: string, color?: string, bold?: boolean, italic?: boolean, underlined?: boolean, strikethrough?: boolean }>): StyledFragment[] {
        const fragments: StyledFragment[] = [];

        components.forEach((component) => {
            // 初始化当前样式
            let currentStyle = {
                color: component.color ? this.getMinecraftColor(component.color) : '#FFFFFF',
                bold: component.bold || false,
                italic: component.italic || false,
                underlined: component.underlined || false,
                strikethrough: component.strikethrough || false
            };

            // 当前正在处理的文本
            let currentText = '';
            const text = component.text;
            // 是否替换下一个字符（用于混淆效果）
            let replaceNextChar = false;
            // 是否为第一个内部片段
            let isFirstInner = true;
            // 当前行偏移量
            let currentLineOffset = 0;

            // 遍历文本中的每个字符
            for (let i = 0; i < text.length; i++) {
                // 处理换行符
                if (text[i] === LINE_BREAK.charAt(0)) {
                    if (currentText) {
                        fragments.push({
                            ...currentStyle,
                            text: currentText,
                            isInner: !isFirstInner,
                            line: currentLineOffset
                        });
                        currentText = '';
                    }

                    currentLineOffset++;
                    // 重置样式
                    currentStyle = {
                        color: '#FFFFFF',
                        bold: false,
                        italic: false,
                        underlined: false,
                        strikethrough: false
                    };
                    replaceNextChar = false;
                    isFirstInner = true;

                    continue;
                }

                // 处理格式代码（以§开头）
                if (text[i] === '§' && i + 1 < text.length) {
                    // 如果已有累积文本，先将其作为一个片段加入结果
                    if (currentText) {
                        fragments.push({
                            ...currentStyle,
                            text: currentText,
                            isInner: !isFirstInner,
                            line: currentLineOffset
                        });
                        currentText = '';
                        isFirstInner = false;
                    }

                    // 获取格式代码
                    const code = text[i + 1].toLowerCase() as FormatCode;
                    i++;

                    // 处理颜色代码
                    if (this.isColorCode(code)) {
                        currentStyle.color = this.formatCodes.color[code];
                        replaceNextChar = false;
                    }
                    // 处理样式代码
                    else if (this.isStyleCode(code)) {
                        switch (this.formatCodes.style[code]) {
                            case 'bold':
                                currentStyle.bold = true;
                                replaceNextChar = false;
                                break;
                            case 'strikethrough':
                                currentStyle.strikethrough = true;
                                replaceNextChar = false;
                                break;
                            case 'underline':
                                currentStyle.underlined = true;
                                replaceNextChar = false;
                                break;
                            case 'italic':
                                currentStyle.italic = true;
                                replaceNextChar = false;
                                break;
                            case 'obfuscated':
                                replaceNextChar = true;
                                break;
                            case 'reset':
                                // 重置所有样式
                                currentStyle = {
                                    color: '#FFFFFF',
                                    bold: false,
                                    italic: false,
                                    underlined: false,
                                    strikethrough: false
                                };
                                replaceNextChar = false;
                                break;
                        }
                    }
                } else {
                    // 关键修复：将普通空格替换为Unicode非换行空格（\u00A0），避免连续空格被合并
                    const charToAdd = replaceNextChar
                        ? OBFUSCATED_SYMBOL
                        : (text[i] === ' ' ? '\u00A0' : text[i]);

                    currentText += charToAdd;
                    replaceNextChar = false;
                }
            }

            // 添加最后的文本片段
            if (currentText) {
                fragments.push({
                    ...currentStyle,
                    text: currentText,
                    isInner: !isFirstInner,
                    line: currentLineOffset
                });
            }
        });

        return fragments;
    }

    /**
     * 应用组件装饰
     * 在编辑器中显示解析后的样式化文本
     * @param editor 当前文本编辑器
     * @param originalLine 原始行号
     * @param fragments 样式化片段数组
     */
    private applyComponentDecorations(
        editor: vscode.TextEditor,
        originalLine: number,
        fragments: StyledFragment[]
    ) {
        // 获取原始行的长度
        const originalLineObj = editor.document.lineAt(originalLine);
        const originalLineLength = originalLineObj.text.length;
        // 行高常量
        const lineHeight = 22;

        // 按行分组片段
        const lineGroups = new Map<number, StyledFragment[]>();
        fragments.forEach(fragment => {
            const groupKey = fragment.line;
            if (!lineGroups.has(groupKey)) {
                lineGroups.set(groupKey, []);
            }
            lineGroups.get(groupKey)!.push(fragment);
        });

        // 创建容器装饰
        const containerId = `container-${Date.now()}`;
        this.decorations.set(containerId, vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ` >`,
                color: '#AAAAAA',
                margin: '0 10px 0 15px',
                fontWeight: 'bold'
            }
        }));
        editor.setDecorations(this.decorations.get(containerId)!, [{
            range: new vscode.Range(originalLine, originalLineLength, originalLine, originalLineLength)
        }]);

        // 逐行应用装饰
        Array.from(lineGroups.entries()).forEach(([lineOffset, lineFragments]) => {
            const targetLine = originalLine + lineOffset;
            // 计算垂直边距
            const topMargin = lineOffset === 0 ? '0' : `${lineOffset * lineHeight}px`;
            // 水平偏移量
            let inlineOffset = 0;

            lineFragments.forEach((fragment, index) => {
                if (!fragment.text) { return; }

                // 创建片段ID
                const id = `fragment-${Date.now()}-${targetLine}-${index}`;
                // 文本装饰样式
                const textDecoration: string[] = [];
                if (fragment.underlined) { textDecoration.push('underline'); }
                if (fragment.strikethrough) { textDecoration.push('line-through'); }

                // 计算水平边距
                const horizontalMargin = fragment.isInner ? '0' : '0 3px 0 0';

                // 创建装饰类型
                this.decorations.set(id, vscode.window.createTextEditorDecorationType({
                    after: {
                        contentText: fragment.text,
                        color: fragment.color,
                        fontWeight: fragment.bold ? 'bold' : 'normal',
                        fontStyle: fragment.italic ? 'italic' : 'normal',
                        textDecoration: textDecoration.join(' ') || 'none',
                        margin: `${topMargin} 0 0 ${horizontalMargin}`
                    }
                }));

                // 应用装饰到编辑器
                editor.setDecorations(this.decorations.get(id)!, [{
                    range: new vscode.Range(
                        targetLine,
                        originalLineLength + inlineOffset,
                        targetLine,
                        originalLineLength + inlineOffset
                    )
                }]);

                // 更新水平偏移量
                inlineOffset += fragment.text.length + (fragment.isInner ? 0 : 1);
            });
        });
    }

    /**
     * 判断是否为颜色代码
     * @param code 待判断的代码
     * @returns 是否为颜色代码
     */
    private isColorCode(code: string): code is ColorCode {
        return ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'].includes(code);
    }

    /**
     * 判断是否为样式代码
     * @param code 待判断的代码
     * @returns 是否为样式代码
     */
    private isStyleCode(code: string): code is StyleCode {
        return ['l', 'm', 'n', 'o', 'r', 'k'].includes(code);
    }

    /**
     * 获取Minecraft颜色值
     * 将颜色名称转换为HEX颜色值
     * @param colorName 颜色名称
     * @returns HEX颜色值
     */
    private getMinecraftColor(colorName: string): string {
        const colorMap: Record<string, string> = {
            'black': '#000000', 'dark_blue': '#0000AA', 'dark_green': '#00AA00',
            'dark_aqua': '#00AAAA', 'dark_red': '#AA0000', 'dark_purple': '#AA00AA',
            'gold': '#FFAA00', 'gray': '#AAAAAA', 'dark_gray': '#555555',
            'blue': '#5555FF', 'green': '#55FF55', 'aqua': '#55FFFF',
            'red': '#FF5555', 'light_purple': '#FF55FF', 'yellow': '#FFFF55',
            'white': '#FFFFFF'
        };
        return colorMap[colorName] || colorName;
    }

    /**
     * 显示警告装饰
     * 当无法解析JSON时，在编辑器中显示警告信息
     * @param editor 当前文本编辑器
     * @param lineNumber 行号
     */
    private showWarningDecoration(editor: vscode.TextEditor, lineNumber: number) {
        const line = editor.document.lineAt(lineNumber);
        const lineLength = line.text.length;

        // 创建警告装饰ID
        const warningId = `warning-${Date.now()}`;
        this.decorations.set(warningId, vscode.window.createTextEditorDecorationType({
            after: {
                contentText: '⚠️ 无法解析',
                color: '#ff9800',
                margin: '0 0 0 15px',
                fontWeight: 'bold'
            }
        }));

        // 应用警告装饰到编辑器
        editor.setDecorations(this.decorations.get(warningId)!, [{
            range: new vscode.Range(lineNumber, lineLength, lineNumber, lineLength)
        }]);
    }

    /**
     * 清除所有装饰
     * 释放所有已创建的装饰资源
     */
    private clearDecorations() {
        this.decorations.forEach(decoration => decoration.dispose());
        this.decorations.clear();
    }

    /**
     * 销毁函数
     * 实现vscode.Disposable接口，用于插件销毁时清理资源
     */
    dispose() {
        // 清除防抖定时器
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // 清除所有装饰
        this.clearDecorations();

        // 释放所有可释放资源
        this.disposables.forEach(d => d.dispose());
    }
}