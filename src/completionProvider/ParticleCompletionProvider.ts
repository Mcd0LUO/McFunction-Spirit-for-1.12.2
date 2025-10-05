import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from '../core/CommandCompletionProvider';
import { ParticleNames } from '../utils/EnumLib';

export class ParticleCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        let result: vscode.CompletionItem[] = [];
        switch (commands.length) {
            case 2:
                for (const particle of ParticleNames.all) {
                    result.push(this.createCompletionItem(particle.name, particle.desc, particle.name + MinecraftCommandCompletionProvider.global_sufiix, true, vscode.CompletionItemKind.Class));
                }
                break;
            case 3:
            case 4:
            case 5:
                return this.createCoordinateCompletions(true);
            case 6:
            case 7:
            case 8:
                result.push(this.createCompletionItem("<value>","偏移量x | y | z", "", true,vscode.CompletionItemKind.Value));
                break;
            case 9:
                result.push(this.createCompletionItem("<value>","粒子速度", "", true,vscode.CompletionItemKind.Value));
                break;
            case 10:
                result.push(this.createCompletionItem("<value>","粒子数量", "", true,vscode.CompletionItemKind.Value));
                break;
            case 11:
                result.push(this.createCompletionItem("normal","普通", "normal ", true,vscode.CompletionItemKind.Keyword));
                result.push(this.createCompletionItem("force","强制", "force ", true,vscode.CompletionItemKind.Keyword));
                break;
            case 12:
                return this.createSelectorArgumentsCompletion(commands[11]);
            case 13:
                result.push(this.createCompletionItem("<value>","参数","",));
        }

        return result;

    }
}