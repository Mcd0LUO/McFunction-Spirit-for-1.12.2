import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from '../core/CommandCompletionProvider';
import { JsonCompletionHelper } from '../utils/JsonMessageCompletionUtils';

export class TitleCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[],lineCommands: string[], document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        switch (commands.length) {
            case 2:
                return this.createSelectorArgumentsCompletion(commands[1]);
            case 3:
                return [
                    this.createCompletionItem('title', "主标题", "title" + MinecraftCommandCompletionProvider.global_sufiix, true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('subtitle', "副标题", "subtitle" + MinecraftCommandCompletionProvider.global_sufiix, true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('actionbar', "物品栏上方", "actionbar" + MinecraftCommandCompletionProvider.global_sufiix, true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('times', "设置时间", "times" + MinecraftCommandCompletionProvider.global_sufiix,true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('clear', "清除设置", "clear" + MinecraftCommandCompletionProvider.global_sufiix,true, vscode.CompletionItemKind.Keyword),

                ];
            case 4:
                if (commands[2] === 'times') {
                    return this.createSingleCompletionItem("<淡入> <滞留> <淡出>", "设置时间参数(tick)", "", false, vscode.CompletionItemKind.Keyword);
                }
                return JsonCompletionHelper.provideJsonTextCompletions(this.extractCommand(document.lineAt(position.line).text.substring(0, position.character)), this.createCompletionItem.bind(this),document, position);


        }
    return [];
    
}
}