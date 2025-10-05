import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from '../core/CommandCompletionProvider';
import { DataLoader } from '../core/DataLoader';

/**
 * JSON文本解析上下文信息
 * 描述光标在JSON结构中的位置和状态
 */
interface JsonContext {
    inString: boolean;
    inObject: boolean;
    inArray: boolean;
    depth: {
        objects: number;
        arrays: number;
    };
    quoteType?: '"' | "'";
    lastValidPosition?: number;
    currentPath?: string[];     // 当前JSON路径，如 ["score", "name"]
    currentKey?: string;        // 当前正在编辑的键
    currentValue?: string;      // 当前正在编辑的值
    componentType?: 'text' | 'selector' | 'score' | 'translate' | 'keybind'; // 组件类型
    inValue?: boolean;          // 是否在值中
}

/**
 * 组件类型配置接口（统一Root/Array补全数据源）
 */
interface ComponentTypeConfig {
    type: 'text' | 'selector' | 'score' | 'translate' | 'keybind';
    label: string;
    description: string;
    rootSnippet: string;       // Root层级补全片段（如 "text":"值"）
    arraySnippet: string;      // Array层级补全片段（如 {"text":"值"}）
    isRequired: boolean;       // 是否为组件必需字段
}

/**
 * 样式属性配置接口
 */
interface StylePropertyConfig {
    label: string;
    description: string;
    values?: (string | boolean)[]; // 可选值列表（支持字符串/布尔）
    isOptional: boolean;
}

/**
 * JSON文本补全工具类
 * 专注于Minecraft命令中JSON文本组件的解析、上下文分析和补全项生成
 * 支持多种JSON组件类型（文本、选择器、计分板等）及样式属性的智能补全
 */
export class JsonCompletionHelper {
    /**
     * 公共常量：Minecraft JSON组件类型配置（统一管理，避免重复定义）
     */
    private static readonly COMPONENT_TYPES: ComponentTypeConfig[] = [
        {
            type: 'text',
            label: 'text',
            description: '文本内容',
            rootSnippet: '"text":"\${1:文本内容}"',
            arraySnippet: '{"text":"\${1:文本内容}"}',
            isRequired: true
        },
        {
            type: 'selector',
            label: 'selector',
            description: '实体选择器',
            rootSnippet: '"selector":"\${1:@p}"',
            arraySnippet: '{"selector":"\${1:@p}"}',
            isRequired: true
        },
        {
            type: 'score',
            label: 'score',
            description: '计分板值',
            rootSnippet: '"score":{"name":"\${1:@p}", "objective":"\${2:objective}"}',
            arraySnippet: '{"score":{"name":"\${1:@p}", "objective":"\${2:objective}"}}',
            isRequired: true
        },
        {
            type: 'translate',
            label: 'translate',
            description: '翻译键（多语言支持）',
            rootSnippet: '"translate":"\${1}"',
            arraySnippet: '{"translate":"\${1}","with":[]}',
            isRequired: true
        },
        {
            type: 'keybind',
            label: 'keybind',
            description: '按键绑定（显示玩家当前按键）',
            rootSnippet: '"keybind":"\${1}"',
            arraySnippet: '{"keybind":"\${1}"}',
            isRequired: true
        }
    ];

    /**
     * 公共常量：Minecraft JSON文本样式属性（统一管理，避免重复定义）
     */
    private static readonly STYLE_PROPERTIES: StylePropertyConfig[] = [
        { label: 'color', description: '文本颜色', values: ["black", "dark_blue", "dark_green", "dark_aqua", "dark_red", "dark_purple", "gold", "gray", "dark_gray", "blue", "green", "aqua", "red", "light_purple", "yellow", "white"], isOptional: true },
        { label: 'bold', description: '粗体样式', values: [true, false], isOptional: true },
        { label: 'italic', description: '斜体样式', values: [true, false], isOptional: true },
        { label: 'underlined', description: '下划线样式', values: [true, false], isOptional: true },
        { label: 'strikethrough', description: '删除线样式', values: [true, false], isOptional: true },
        { label: 'obfuscated', description: '模糊（乱码）样式', values: [true, false], isOptional: true }
    ];

    /**
     * 公共常量：可能的组件类型关键字（用于上下文识别）
     */
    private static readonly POSSIBLE_COMPONENT_TYPES: string[] = ['text', 'selector', 'score', 'translate', 'keybind'];

    /**
     * 提供JSON文本内容补全的入口方法
     * 根据当前输入的JSON片段上下文，动态生成对应的补全项
     * 
     * @param commands 已解析的光标前命令参数数组，最后一项为当前编辑的JSON片段
     * @param fulljson 命令json文本部分
     * @param createCompletionItem 外部提供的补全项创建函数（保持风格一致性）
     * @param document 当前文档
     * @param position 当前光标位置
     * @returns 适用于当前JSON上下文的补全项数组
     */
    static provideJsonTextCompletions(
        commands: string[],
        fulljson: string,
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem,
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const currentJsonFragment = commands[commands.length - 1] || '';
        const cursorPosition = currentJsonFragment.length;

        // 解析JSON上下文 + 传递JSON片段（用于后续键提取）
        const jsonContext = this.analyzeJsonContext(currentJsonFragment, cursorPosition);

        // 生成补全项时传入JSON片段，修复键提取bug
        return this.generateCompletionsForContext(
            jsonContext,
            currentJsonFragment,
            createCompletionItem
        );
    }

    /**
     * 分析JSON文本片段，确定光标所在的上下文状态
     * 
     * @param jsonFragment 要分析的JSON文本片段
     * @param cursorPosition 光标在文本中的位置
     * @returns 包含光标上下文信息的对象
     */
    static analyzeJsonContext(jsonFragment: string, cursorPosition: number): JsonContext {
        const context: JsonContext = {
            inString: false,
            inObject: false,
            inArray: false,
            depth: { objects: 0, arrays: 0 },
            currentPath: [],
            currentKey: undefined,
            currentValue: undefined,
            componentType: undefined,
            inValue: false,
            quoteType: undefined,
            lastValidPosition: -1
        };

        let escaped = false;
        let braceBalance = 0; // 花括号平衡（独立跟踪，不受其他逻辑干扰）
        let bracketBalance = 0; // 方括号平衡
        let currentChar: string;
        let expectingValue = false;
        let buffer = '';
        let inKeyBuffer = false;

        // 第一步：快速扫描计算括号平衡（优先级最高）
        for (let i = 0; i < cursorPosition; i++) {
            currentChar = jsonFragment[i] || '';
            if (currentChar === '\\') {
                escaped = !escaped;
                continue;
            }
            // 处理字符串状态切换
            if ((currentChar === '"' || currentChar === "'") && !escaped) {
                context.inString = !context.inString;
            }
            // 非字符串状态下计算括号平衡
            if (!context.inString && !escaped) {
                braceBalance += currentChar === '{' ? 1 : currentChar === '}' ? -1 : 0;
                bracketBalance += currentChar === '[' ? 1 : currentChar === ']' ? -1 : 0;
                // 防止平衡值为负（非法JSON片段）
                braceBalance = Math.max(0, braceBalance);
                bracketBalance = Math.max(0, bracketBalance);
            }
            escaped = false;
        }

        // 强制设置基础上下文（基于括号平衡）
        context.depth.objects = braceBalance;
        context.depth.arrays = bracketBalance;
        context.inObject = braceBalance > 0;
        context.inArray = bracketBalance > 0;

        // 重置状态，进行详细上下文扫描（键/值/组件类型识别）
        escaped = false;
        context.inString = false;
        expectingValue = false;
        buffer = '';
        inKeyBuffer = false;

        for (let i = 0; i < cursorPosition; i++) {
            currentChar = jsonFragment[i] || '';
            context.lastValidPosition = i;

            // 1. 处理转义字符
            if (currentChar === '\\' && !escaped) {
                escaped = true;
                buffer += currentChar;
                continue;
            }

            // 2. 处理字符串（键/值提取）
            if ((currentChar === '"' || currentChar === "'") && !escaped) {
                if (!context.inString) {
                    // 进入字符串：初始化缓冲和状态
                    context.inString = true;
                    context.quoteType = currentChar as '"' | "'";
                    buffer = '';
                    inKeyBuffer = !expectingValue; // 非期待值状态 → 字符串为键
                } else if (context.quoteType === currentChar) {
                    // 退出字符串：解析键/值
                    context.inString = false;
                    const stringContent = buffer;

                    if (expectingValue) {
                        context.currentValue = stringContent;
                        context.inValue = false;
                    } else {
                        context.currentKey = stringContent;
                        // 识别顶级组件类型（对象深度为1时）
                        if (braceBalance === 1 && !context.componentType &&
                            this.POSSIBLE_COMPONENT_TYPES.includes(stringContent)) {
                            context.componentType = stringContent as any;
                        }
                    }
                    expectingValue = !expectingValue; // 切换期待值状态
                    buffer = '';
                    inKeyBuffer = false;
                }
            } else if (context.inString) {
                // 字符串内：累积缓冲
                buffer += currentChar;
            }

            // 3. 非字符串处理（冒号/逗号/空格）
            if (!context.inString && !escaped) {
                switch (currentChar) {
                    case ':':
                        // 冒号：前面的缓冲为键，后续为值
                        if (!expectingValue && buffer.trim()) {
                            context.currentKey = buffer.trim();
                            // 识别顶级组件类型
                            if (braceBalance === 1 && !context.componentType &&
                                this.POSSIBLE_COMPONENT_TYPES.includes(buffer.trim())) {
                                context.componentType = buffer.trim() as any;
                            }
                        }
                        expectingValue = true;
                        context.inValue = true;
                        buffer = '';
                        break;
                    case ',':
                        // 逗号：重置期待值状态
                        expectingValue = false;
                        context.inValue = false;
                        buffer = '';
                        inKeyBuffer = braceBalance > 0; // 对象内允许后续键输入
                        break;
                    case ' ':
                    case '\t':
                    case '\n':
                        // 空格：忽略
                        break;
                    default:
                        // 其他字符：累积键缓冲（非期待值状态下）
                        if (inKeyBuffer && !expectingValue &&
                            !['{', '}', '[', ']'].includes(currentChar)) {
                            buffer += currentChar;
                        }
                        break;
                }
            }

            escaped = false;
        }

        // 4. 处理剩余缓冲（光标在字符串内或未完成输入）
        if (buffer.length > 0) {
            if (expectingValue) {
                context.currentValue = buffer;
                context.inValue = true;
            } else {
                context.currentKey = buffer;
                // 识别未完成的组件类型（前缀匹配）
                if (braceBalance === 1 && !context.componentType &&
                    this.POSSIBLE_COMPONENT_TYPES.some(t => t.startsWith(buffer.toLowerCase()))) {
                    context.componentType = buffer as any;
                }
            }
        }

        // 最终保障：对象深度>0时强制标记为inObject
        context.inObject = context.depth.objects > 0;

        return context;
    }

    /**
     * 根据JSON上下文生成相应的补全项（核心分发逻辑）
     * 
     * @param context JSON上下文信息
     * @param jsonFragment 当前编辑的JSON片段（用于键提取）
     * @param createCompletionItem 补全项创建函数
     * @returns 补全项数组
     */
    static generateCompletionsForContext(
        context: JsonContext,
        jsonFragment: string,
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        // 1. 字符串内补全（选择器、转义符等）
        if (context.inString) {
            const fullPath = [...(context.currentPath || []), context.currentKey].join('.');
            // 特殊属性值补全（score.name/score.objective/selector）
            if (fullPath === 'score.name' || context.currentKey === 'selector') {
                return this.getSelectorCompletions(createCompletionItem);
            }
            if (fullPath === 'score.objective') {
                return this.getScoreboardCompletions(createCompletionItem);
            }
            // 普通字符串补全（转义符、颜色符）
            return this.getInStringCompletions(createCompletionItem);
        }

        // 2. 对象内补全（根据组件类型分发）
        if (context.inObject) {
            const existingKeys = this.extractExistingKeys(jsonFragment);
            switch (context.componentType) {
                case 'text':
                    return [
                        ...this.getCommonStyleCompletions(existingKeys, createCompletionItem),
                        ...this.getTextComponentSpecificCompletions(existingKeys, createCompletionItem)
                    ];
                case 'selector':
                case 'translate':
                case 'keybind':
                    return this.getCommonStyleCompletions(existingKeys, createCompletionItem);
                case 'score':
                    return this.getScoreComponentCompletions(existingKeys, context, createCompletionItem);
                default:
                    return this.getRootComponentCompletions(existingKeys, createCompletionItem);
            }
        }

        // 3. 数组内补全（组件对象）
        if (context.inArray) {
            return this.getArrayItemCompletions(createCompletionItem);
        }

        // 4. 顶级补全（单个组件或组件数组）
        return this.getTopLevelCompletions(createCompletionItem);
    }

    // ======================== 公共补全方法 ========================

    /**
     * 公共方法：生成样式属性补全（文本/选择器/翻译等组件通用）
     * 修复：布尔值（true/false）补全时不包裹引号，字符串值包裹引号
     * 
     * @param existingKeys 已存在的键（避免重复补全）
     * @param createCompletionItem 补全项创建函数
     * @returns 样式补全项数组
     */
    private static getCommonStyleCompletions(
        existingKeys: Set<string>,
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        return this.STYLE_PROPERTIES
            .filter(prop => !existingKeys.has(prop.label)) // 过滤已存在的键
            .map(prop => {
                let insertText: vscode.SnippetString;

                if (prop.values) {
                    // 区分值类型：布尔值不加引号，字符串加双引号
                    const formattedValues = prop.values.map(value =>
                        typeof value === 'boolean' ? value : `"${value}"`
                    ).join(',');

                    // 生成带类型区分的Snippet（如 "bold":${1|true,false|} 或 "color":"${1|red,blue|}"）
                    insertText = new vscode.SnippetString(`"${prop.label}":\${1|${formattedValues}|}`);
                } else {
                    // 无可选值时，默认生成空字符串（如 "customProp":""）
                    insertText = new vscode.SnippetString(`"${prop.label}":""`);
                }

                return createCompletionItem(
                    prop.label,
                    prop.description,
                    insertText,
                    prop.isOptional,
                    vscode.CompletionItemKind.Property
                );
            });
    }

    /**
     * 公共方法：提取JSON片段中已存在的键（修复原逻辑bug）
     * 
     * @param jsonFragment 要分析的JSON片段
     * @returns 已存在的键集合
     */
    private static extractExistingKeys(jsonFragment: string): Set<string> {
        const existingKeys = new Set<string>();
        if (!jsonFragment) {return existingKeys;}

        let inString = false;
        let quoteType: '"' | "'" | null = null;
        let inKey = false;
        let currentKey = '';
        let escaped = false;

        for (const char of jsonFragment) {
            if (escaped) {
                escaped = false;
                continue;
            }

            // 处理转义
            if (char === '\\') {
                escaped = true;
                continue;
            }

            // 处理字符串边界（键的开始/结束）
            if ((char === '"' || char === "'") && !escaped) {
                inString = !inString;
                if (inString) {
                    // 进入字符串：标记为键的开始
                    quoteType = char as '"' | "'";
                    inKey = true;
                    currentKey = '';
                } else if (inKey && quoteType === char) {
                    // 退出字符串：保存键
                    existingKeys.add(currentKey);
                    inKey = false;
                }
                continue;
            }

            // 字符串内累积键内容
            if (inString && inKey) {
                currentKey += char;
            }
        }

        return existingKeys;
    }

    /**
     * 公共方法：创建JSON通用补全项（封装重复的补全项配置）
     * 
     * @param label 补全项显示标签
     * @param insertText 插入片段
     * @param description 补全项描述
     * @param createCompletionItem 外部创建函数
     * @param isOptional 是否为可选项
     * @param kind 补全项类型
     * @returns VS Code补全项对象
     */
    private static createJsonCompletion(
        label: string,
        insertText: string,
        description: string,
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem,
        isOptional = false,
        kind = vscode.CompletionItemKind.Snippet
    ): vscode.CompletionItem {
        const snippet = new vscode.SnippetString(insertText);
        const item = createCompletionItem(label, description, snippet, isOptional, kind);
        item.insertText = snippet; // 显式设置片段，确保VS Code正确解析
        return item;
    }

    // ======================== 具体场景补全方法 ========================

    /**
     * 字符串内补全（转义符、颜色符等）
     * 
     * @param createCompletionItem 补全项创建函数
     * @returns 字符串补全项数组
     */
    private static getInStringCompletions(
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        return [
            this.createJsonCompletion(
                "Minecraft颜色符",
                "§",
                "插入§颜色控制符（如§a绿色）",
                createCompletionItem
            ),
            this.createJsonCompletion(
                "转义双引号",
                "\\\"",
                "在字符串内插入双引号（避免JSON语法错误）",
                createCompletionItem
            ),
            this.createJsonCompletion(
                "换行符",
                "\\n",
                "插入换行符（文本换行显示）",
                createCompletionItem
            )
        ];
    }

    /**
     * Text组件专属补全（事件属性：hover/click）
     * （样式属性已通过公共方法getCommonStyleCompletions生成）
     * 
     * @param existingKeys 已存在的键
     * @param createCompletionItem 补全项创建函数
     * @returns Text组件专属补全项
     */
    private static getTextComponentSpecificCompletions(
        existingKeys: Set<string>,
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        const completions: vscode.CompletionItem[] = [];

        // Hover事件补全
        if (!existingKeys.has("hoverEvent")) {
            completions.push(createCompletionItem(
                "hoverEvent",
                "鼠标悬停事件（显示文本/物品/实体）",
                new vscode.SnippetString(`"hoverEvent":{"action":"\${1|show_text,show_item,show_entity|}","value":\${2}}`),
                true,
                vscode.CompletionItemKind.Property
            ));
        }

        // Click事件补全
        if (!existingKeys.has("clickEvent")) {
            completions.push(createCompletionItem(
                "clickEvent",
                "鼠标点击事件（打开链接/执行命令）",
                new vscode.SnippetString(`"clickEvent":{"action":"\${1|open_url,run_command,suggest_command,change_page|}","value":"\${2}"}`),
                true,
                vscode.CompletionItemKind.Property
            ));
        }

        return completions;
    }

    /**
     * Score组件补全（name/objective属性 + 通用样式）
     * 
     * @param existingKeys 已存在的键
     * @param context JSON上下文
     * @param createCompletionItem 补全项创建函数
     * @returns Score组件补全项
     */
    private static getScoreComponentCompletions(
        existingKeys: Set<string>,
        context: JsonContext,
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        const completions: vscode.CompletionItem[] = [];

        // 若在score对象内部（需要补全name/objective）
        if (context.currentPath?.includes('score')) {
            if (!existingKeys.has("name")) {
                completions.push(createCompletionItem(
                    "name",
                    "实体选择器（如@p/@a）",
                    new vscode.SnippetString(`"name":"\${1}"`),
                    false,
                    vscode.CompletionItemKind.Property
                ));
            }
            if (!existingKeys.has("objective")) {
                completions.push(createCompletionItem(
                    "objective",
                    "计分板目标名称",
                    new vscode.SnippetString(`"objective":"\${1}"`),
                    false,
                    vscode.CompletionItemKind.Property
                ));
            }
        }

        // 追加通用样式补全
        return [...completions, ...this.getCommonStyleCompletions(existingKeys, createCompletionItem)];
    }

    /**
     * Root组件补全（未识别组件类型时，补全基础组件键）
     * 
     * @param existingKeys 已存在的键
     * @param createCompletionItem 补全项创建函数
     * @returns Root组件补全项
     */
    private static getRootComponentCompletions(
        existingKeys: Set<string>,
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        return this.COMPONENT_TYPES
            .filter(type => !existingKeys.has(type.label)) // 过滤已存在的组件键
            .map(type => createCompletionItem(
                type.label,
                type.description,
                new vscode.SnippetString(type.rootSnippet),
                !type.isRequired, // 必需字段标记为非可选
                vscode.CompletionItemKind.Property
            ));
    }

    /**
     * 数组项补全（补全组件对象）
     * 
     * @param createCompletionItem 补全项创建函数
     * @returns 数组项补全项
     */
    private static getArrayItemCompletions(
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        return this.COMPONENT_TYPES.map(type => createCompletionItem(
            `${type.label}组件`,
            type.description,
            new vscode.SnippetString(type.arraySnippet),
            true,
            vscode.CompletionItemKind.Value
        ));
    }

    /**
     * 顶级补全（空JSON时，补全单个组件或组件数组）
     * 
     * @param createCompletionItem 补全项创建函数
     * @returns 顶级补全项
     */
    private static getTopLevelCompletions(
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        // 1. 单个组件补全
        const componentCompletions = this.COMPONENT_TYPES.map(type => createCompletionItem(
            `${type.label}组件`,
            type.description,
            new vscode.SnippetString(`{${type.rootSnippet}}`),
            true,
            vscode.CompletionItemKind.Value
        ));

        // 2. 组件数组补全
        const arrayCompletion = createCompletionItem(
            "组件数组",
            "包含多个JSON组件的数组（支持多段文本组合）",
            new vscode.SnippetString('[${1:}]'),
            true,
            vscode.CompletionItemKind.Value
        );

        return [...componentCompletions, arrayCompletion];
    }

    /**
     * 选择器补全（复用MinecraftCommandCompletionProvider的选择器配置）
     * 
     * @param createCompletionItem 补全项创建函数
     * @returns 选择器补全项
     */
    private static getSelectorCompletions(
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        return MinecraftCommandCompletionProvider.ENTITY_SELECTORS.map(selector =>
            createCompletionItem(
                selector.label,
                selector.detail || "实体选择器",
                selector.label,
                false,
                vscode.CompletionItemKind.Variable
            )
        );
    }

    /**
     * 计分板目标补全（从DataLoader获取已存在的计分板）
     * 
     * @param createCompletionItem 补全项创建函数
     * @returns 计分板补全项
     */
    private static getScoreboardCompletions(
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string | vscode.SnippetString,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        const scoreboards = DataLoader.getScoreboardMap();
        return Object.entries(scoreboards).map(([name, [criterion, displayName]]) =>
            createCompletionItem(
                name,
                `${displayName || '无显示名'} (判据: ${criterion})`,
                name,
                false,
                vscode.CompletionItemKind.Variable
            )
        );
    }
}