import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from './CommandCompletionProvider';

export class MainCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        // 此方法不会被调用，因为基类已处理所有分发
        return [];
    }


    public static instance: MainCompletionProvider = new MainCompletionProvider();

}