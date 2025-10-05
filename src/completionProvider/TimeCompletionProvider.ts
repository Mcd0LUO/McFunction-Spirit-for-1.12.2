import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from '../core/CommandCompletionProvider';

export class TimeCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(
        commands: string[],
        lineCommands: string[],
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        
        switch (commands.length) {
            case 2:
                // 第二个参数：time命令的子命令
                return [
                    this.createCompletionItem('set', "设置时间", 'set ', true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('add', "增加时间", 'add ', true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('query', "查询时间", 'query ', true, vscode.CompletionItemKind.Keyword)
                ];
            
            case 3:
                // 第三个参数：根据不同的子命令提供不同的补全项
                switch (commands[1]) {
                    case 'set':
                        // set命令可以设置具体时间值或预设时间关键词
                        return [
                            this.createCompletionItem('<time>', "时间值（刻）", '', true, vscode.CompletionItemKind.Value),
                            this.createCompletionItem('day', "白天 (1000刻)", 'day ', false, vscode.CompletionItemKind.Enum),
                            this.createCompletionItem('noon', "中午 (6000刻)", 'noon ', false, vscode.CompletionItemKind.Enum),
                            this.createCompletionItem('night', "夜晚 (13000刻)", 'night ', false, vscode.CompletionItemKind.Enum),
                        ];
                    
                    case 'add':
                        // add命令需要一个时间值
                        return [
                            this.createCompletionItem('<time>', "要增加的时间值（刻）", '', true, vscode.CompletionItemKind.Value)
                        ];
                    
                    case 'query':
                        // query命令可以查询不同种类的时间
                        return [
                            this.createCompletionItem('daytime', "当天时间（刻）", 'daytime ', false, vscode.CompletionItemKind.Enum),
                            this.createCompletionItem('gametime', "游戏总时间（刻）", 'gametime ', false, vscode.CompletionItemKind.Enum),
                            this.createCompletionItem('day', "游戏天数", 'day ', false, vscode.CompletionItemKind.Enum)
                        ];
                }
                break;
                
            case 4:
                // 第四个参数：对于set命令，如果使用具体数值，可以提供单位选项
                if (commands[1] === 'set' && !['day', 'noon', 'night', 'midnight'].includes(commands[2])) {
                    return [
                        this.createCompletionItem('t', "游戏刻 (tick)", 't', false, vscode.CompletionItemKind.Unit),
                        this.createCompletionItem('s', "秒 (second)", 's', false, vscode.CompletionItemKind.Unit),
                        this.createCompletionItem('d', "天 (day)", 'd', false, vscode.CompletionItemKind.Unit)
                    ];
                }
                break;
        }
        
        return [];
    }
}