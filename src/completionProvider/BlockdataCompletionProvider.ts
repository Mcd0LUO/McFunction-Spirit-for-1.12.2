import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";



export class BlockdataCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {

    switch (commands.length) {
            case 2:
            case 3:
            case 4:
                // 处理坐标参数的自动补全
                return this.createCoordinateCompletions(true);
            case 5:
                // 处理数据标签参数的自动补全
            return [this.createCompletionItem("{}", "原始json文本","{${1:}}",false)];
}


        return [];
    }
}