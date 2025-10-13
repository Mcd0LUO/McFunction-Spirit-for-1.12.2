export type ColorCode = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f';

/**
 * Minecraft样式代码枚举
 * l:粗体  m:删除线  n:下划线  o:斜体  r:重置  k:随机字符
 */
export type StyleCode = 'l' | 'm' | 'n' | 'o' | 'r' | 'k';

/**
 * 格式代码联合类型，包含颜色和样式代码
 */
export type FormatCode = ColorCode | StyleCode;

/**
 * 混淆文本符号，用于替代混淆格式代码(k)的内容
 */
export const OBFUSCATED_SYMBOL = '■';

/**
 * 换行符常量
 */
export const LINE_BREAK = '\n';


export class JsonMessageUtils {
    

    static instance: JsonMessageUtils;

    static getInstance() {
        if (!JsonMessageUtils.instance) {
            JsonMessageUtils.instance = new JsonMessageUtils();
        }
        return JsonMessageUtils.instance;
    }

    /**
     * 标准化组件数据
     * 将各种格式的JSON组件转换为统一的内部格式
     * @param components 原始组件数组
     * @returns 标准化后的组件数组
     */
    public normalizeComponents(components: any[]): Array<{ text: string, color?: string, bold?: boolean, italic?: boolean, underlined?: boolean, strikethrough?: boolean }> {
        return components.map(component => {
            // 处理选择器组件
            if (typeof component === 'object' && component.selector) {
                return {
                    text: component.selector,
                    color: component.color,
                    bold: this.parseBooleanProperty(component.bold),
                    italic: this.parseBooleanProperty(component.italic),
                    underlined: this.parseBooleanProperty(component.underlined),
                    strikethrough: this.parseBooleanProperty(component.strikethrough)
                };
            }

            // 处理计分板组件
            if (typeof component === 'object' && component.score) {
                const score = component.score;
                const scoreText = score.name ? `${score.name}:${score.objective}` : score.objective;
                return {
                    text: scoreText,
                    color: component.color,
                    bold: this.parseBooleanProperty(component.bold),
                    italic: this.parseBooleanProperty(component.italic),
                    underlined: this.parseBooleanProperty(component.underlined),
                    strikethrough: this.parseBooleanProperty(component.strikethrough)
                };
            }

            // 处理字符串组件
            if (typeof component === 'string') {
                return {
                    text: component,
                    bold: false,
                    italic: false,
                    underlined: false,
                    strikethrough: false
                };
            }

            // 处理普通对象组件
            if (typeof component === 'object') {
                return {
                    text: component.text || '',
                    color: component.color,
                    bold: this.parseBooleanProperty(component.bold),
                    italic: this.parseBooleanProperty(component.italic),
                    underlined: this.parseBooleanProperty(component.underlined),
                    strikethrough: this.parseBooleanProperty(component.strikethrough)
                };
            }

            // 处理其他类型组件
            return {
                text: String(component),
                bold: false,
                italic: false,
                underlined: false,
                strikethrough: false
            };
        });
    }

    private parseBooleanProperty(value: any): boolean {
        if (typeof value === 'boolean') { return value; }
        if (typeof value === 'string') { return value.toLowerCase() === 'true'; }
        return false;
    }

}