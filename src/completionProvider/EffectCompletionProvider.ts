import * as vscode from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";

export class EffectCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[]): vscode.CompletionItem[] {
        
        
        if (commands.length === 2) {
            if (commands[1].includes("@")) {
                return [];
            }
            return this.createSelectorCompletion();
        }
        if (commands.length === 3) {
            return [
                this.createCompletionItem("absorption", "伤害吸收", "absorption ", true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('blindness', '失明', 'blindness ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('fire_resistance', '火焰抗性', 'fire_resistance ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('glowing', '发光', 'glowing ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('haste', '急迫', 'haste ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('health_boost', '生命提升', 'health_boost ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('hunger', '饥饿', 'hunger ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('instant_damage', '瞬间伤害', 'instant_damage ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('instant_health', '瞬间伤害', 'instant_health ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('invisibility', '隐形', 'invisibility ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('jump_boost', '跳跃提升', 'jump_boost ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('levitation', '飘浮', 'levitation ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('luck', '幸运', 'luck ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('mining_fatigue', '挖掘疲劳', 'mining_fatigue ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('nausea', '反胃', 'nausea ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('night_vision', '夜视', 'night_vision ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('poison', '中毒', 'poison ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('regeneration', '生命恢复', 'regeneration ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('resistance', '抗性提升', 'resistance ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('saturation', '饱和度', 'saturation ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('slowness', '缓慢', 'slowness ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('speed', '速度提升', 'speed ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('strength', '力量提升', 'strength ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('unluck', '霉运', 'unluck ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('water_breathing', '水下呼吸', 'water_breathing ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('weakness', '虚弱', 'weakness ', true, vscode.CompletionItemKind.Class),
                this.createCompletionItem('wither', '凋零', "wither ",true, vscode.CompletionItemKind.Class)

            ];

        }
        if (commands.length === 4) {
            return [this.createCompletionItem("<value>", "持续时间", "", true, vscode.CompletionItemKind.Constant)];
        }
        if (commands.length === 5) {
            return [this.createCompletionItem("<value>", "效果等级[从0开始计数]", "", true, vscode.CompletionItemKind.Constant)];
        }


        return [];
    } 
}