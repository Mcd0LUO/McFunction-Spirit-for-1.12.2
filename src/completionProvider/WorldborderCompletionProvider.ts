import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from '../core/CommandCompletionProvider';

export class WorldborderCompletionProvider extends MinecraftCommandCompletionProvider {


    public provideCommandCompletions(
        commands: string[],
        lineCommands: string[],
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        switch (commands.length) {
            case 2:
                // 提供worldborder的子命令补全
                return [
                    this.createCompletionItem('add', '增加或减少世界边界的大小', 'add ', true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('set', '设置世界边界的大小', 'set ', true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('center', '设置世界边界的中心点', 'center ', true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('damage', '设置世界边界伤害', 'damage ', true, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('get', '获取当前世界边界的大小', 'get ', false, vscode.CompletionItemKind.Keyword),
                    this.createCompletionItem('warning', '设置世界边界警告', 'warning ', true, vscode.CompletionItemKind.Keyword)
                ];
            
            case 3:
                // 根据不同的子命令提供不同的补全
                switch (commands[1]) {
                    case 'add':
                    case 'set':
                        // add/set命令需要一个数值参数
                        return [
                            this.createCompletionItem('<size>', '边界大小（方块数）', '', true, vscode.CompletionItemKind.Value)
                        ];
                    
                    case 'center':
                        // center命令需要x和z坐标
                        return this.createCoordinateCompletions();
                        
                    case 'damage':
                        // damage命令有amount和buffer两个子选项
                        return [
                            this.createCompletionItem('amount', '设置每方块伤害值', 'amount ', true, vscode.CompletionItemKind.Keyword),
                            this.createCompletionItem('buffer', '设置伤害缓冲距离', 'buffer ', true, vscode.CompletionItemKind.Keyword)
                        ];
                        
                    case 'warning':
                        // warning命令有distance和time两个子选项
                        return [
                            this.createCompletionItem('distance', '设置警告距离', 'distance ', true, vscode.CompletionItemKind.Keyword),
                            this.createCompletionItem('time', '设置警告时间', 'time ', true, vscode.CompletionItemKind.Keyword)
                        ];
                }
                break;
                
            case 4:
                // 根据不同子命令提供更多参数
                switch (commands[1]) {
                    case 'add':
                    case 'set':
                        // add/set命令的第二个参数是时间（可选）
                        return [
                            this.createCompletionItem('<time>', '变化所需时间（秒）', '', true, vscode.CompletionItemKind.Value)
                        ];
                        
                    case 'damage':
                        if (commands[2] === 'amount') {
                            return [
                                this.createCompletionItem('<damage>', '每方块伤害值 初始值:0.2', '', true, vscode.CompletionItemKind.Value)
                            ];
                        } else if (commands[2] === 'buffer') {
                            return [
                                this.createCompletionItem('<distance>', '缓冲距离', '', true, vscode.CompletionItemKind.Value)
                            ];
                        }
                        break;
                    case 'center':
                        return this.createCoordinateCompletions();
                        
                    case 'warning':
                        if (commands[2] === 'distance') {
                            return [
                                this.createCompletionItem('<distance>', '警告距离 初始值:5b', '', true, vscode.CompletionItemKind.Value)
                            ];
                        } else if (commands[2] === 'time') {
                            return [
                                this.createCompletionItem('<time>', '警告时间（秒） 初始值:15s', '', true, vscode.CompletionItemKind.Value)
                            ];
                        }
                        break;
                }
                break;
        }

        return [];
    }
}