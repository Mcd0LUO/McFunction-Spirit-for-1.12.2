import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";
import * as vscode from "vscode";
import { DataLoader } from "../core/DataLoader";

export class FunctionCompletionProvider extends MinecraftCommandCompletionProvider {
    /**
     * 提供命令补全
     * @param commands 已解析的命令片段数组
     * @param document 当前文档
     * @param position 光标位置
     * @returns 补全项数组
     */
    public provideCommandCompletions(
        commands: string[],
        lineCommands: string[],
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        // 根据命令片段长度提供不同的补全逻辑
        switch (commands.length) {
            case 2:
                return this.provideFunctionPathCompletions(commands[1], document, position);
            case 3:
                return this.provideConditionCompletions();
            case 4:
                return this.createSelectorArgumentsCompletion(commands[3],false);
            default:
                return [];
        }
    }

    /**
     * 提供函数路径补全
     * @param currentInput 当前输入的命令片段
     * @param document 当前文档
     * @param position 光标位置
     * @returns 函数路径补全项数组
     */
    private provideFunctionPathCompletions(
        currentInput: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const functionPaths = DataLoader.getFunctionPaths();
        if (!functionPaths?.length) {
            return [];
        }

        // 计算当前输入的文本范围
        const wordRange = this.getWordRange(document, position, currentInput.length);

        return functionPaths.map(path => {
            // 处理路径格式，移除后缀并替换分隔符
            const displayPath = path.replace("/", ":").slice(0, -11);

            const item = this.createCompletionItem(
                displayPath,
                '函数路径',
                displayPath,
                false,
                vscode.CompletionItemKind.File
            );

            // 设置替换范围
            if (wordRange) {
                item.range = wordRange;
            }
        
            return item;
        });
    }

    /**
     * 提供条件判断关键字补全
     * @returns 条件关键字补全项数组
     */
    private provideConditionCompletions(): vscode.CompletionItem[] {
        return [
            this.createCompletionItem("if", "条件判断控制语句", "if ", true),
            this.createCompletionItem("unless", "条件判断控制语句", "unless ", true)
        ];
    }


}