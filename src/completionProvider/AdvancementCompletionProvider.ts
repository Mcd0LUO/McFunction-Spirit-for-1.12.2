import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";
import { DataLoader } from "../core/DataLoader";

export class AdvancementCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[],lineCommands: string[], document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {    
        
        if (commands.length === 2) {
            return [
                this.createCompletionItem('grant', '授予', 'grant '),
                this.createCompletionItem('revoke', '撤销', 'revoke '),
                this.createCompletionItem('test', '检测', 'test '),
            ];
        }
        if (commands.length === 3) {
            return this.createSelectorArgumentsCompletion(commands[2], true);
        }
        if (commands.length === 4) {
            if (["grant","revoke"].includes(commands[1])) {
                return [
                    this.createCompletionItem('only',"仅",'only ',true),
                    this.createCompletionItem('from',"DFS递归移除本目录以及下游目录进度",'from ',true),
                    this.createCompletionItem('through',"递归移除本目录所处所有上下游目录进度",'through ',true),
                    this.createCompletionItem('everything',"移除所有进度",'everything ',true),
                ];
            }
            if (commands[1] === "test") {
                return this.createAdvancementCompletion(commands[3],document,position);
            }
        }
        if (commands.length === 5 && ['grant', 'revoke'].includes(commands[1])) {
            return this.createAdvancementCompletion(commands[4],document,position);
        }
        if (commands.length === 5 && "test" === commands[1]) {
            return [];
        }



        return [];
    } 

    private createAdvancementCompletion(word:string ,document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        //获取进度路径首在本文件的pos
        let pos = position.with(position.line, position.character - word.length);
        //获取进度路径的范围
        const wordRange = document.getWordRangeAtPosition(pos);
        let displayPath;
        // console.log(this.functionPaths);
        return DataLoader.getAdvancementPaths().map(path => {
            displayPath = path.replace("/",":").slice(0, -5);
            const item = this.createCompletionItem(displayPath, '进度路径', displayPath , false, vscode.CompletionItemKind.File);
            //修改覆盖
            if (wordRange) {
            item.range = wordRange;
            }
            return item;
            }
        );
        
    }

}