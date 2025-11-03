import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';

/**
 * Minecraft 1.12.2 进度文件补全处理器
 * 封装所有触发器补全逻辑，支持动态扩展
 */
export class AdvancementHelper {
    // 触发器-条件映射表（1.12.2原生触发器）
    private triggerConditions: Record<string, TriggerCondition> = {
        "minecraft:inventory_changed": {
            fields: [
                { name: "items", required: true, example: "[{ item: \"minecraft:stone\" }]", description: "背包中变化的物品列表" },
                { name: "slots", required: false, example: "[\"mainhand\", \"inventory\"]", description: "受影响的物品栏槽位" }
            ]
        },
        "minecraft:player_hurt_entity": {
            fields: [
                { name: "entity", required: false, example: "{ type: \"minecraft:zombie\", nbt: \"{Tags:['monster']}\" }", description: "被攻击的实体" },
                { name: "damage", required: true, example: "{ amount: 5, source_entity: { type: \"minecraft:player\" } }", description: "伤害信息" }
            ]
        },
        "minecraft:entity_hurt_player": {
            fields: [
                { name: "damage", required: true, example: "{ direct_entity: { nbt: \"{Tags:['monster']}\" } }", description: "伤害信息" }
            ]
        },
        "minecraft:break_block": {
            fields: [
                { name: "block", required: true, example: "{ block: \"minecraft:diamond_ore\", data: 0 }", description: "被破坏的方块" },
                { name: "location", required: false, example: "{ dimension: \"minecraft:overworld\", y: { min: 1, max: 16 } }", description: "破坏位置" }
            ]
        },
        // 此处省略其他30个原生触发器，实际使用时需补全
        // 格式参照上述示例，严格遵循1.12.2官方规范
    };

    /**
     * 获取补全项
     * @param document 当前文档
     * @param position 光标位置
     * @returns 补全项列表
     */
    public getCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const path = jsonc.getLocation(text, offset).path;
        // 检查是否在 criteria.xxx.conditions 内部
        if (!this.isInConditionsContext(path)) {
            return [];
        }

        // 获取当前触发器名称
        const currentTrigger = this.getCurrentTrigger(text, path);
        if (!currentTrigger || !this.triggerConditions[currentTrigger]) {
            return [];
        }

        // 生成补全项
        return this.createCompletionItems(currentTrigger);
    }

    /**
     * 添加自定义触发器（支持Mod扩展）
     * @param trigger 触发器ID（如"my_mod:custom_trigger"）
     * @param conditions 触发器条件配置
     */
    public addCustomTrigger(trigger: string, conditions: TriggerCondition): void {
        this.triggerConditions[trigger] = conditions;
    }

    /**
     * 判断当前路径是否在 conditions 上下文
     * @param path JSON路径
     */
    private isInConditionsContext(path: (string | number)[]): boolean {
        return path.length >= 3
            && path[0] === "criteria"
            && typeof path[1] === "string"
            && path[2] === "conditions";
    }

    /**
     * 获取当前条件对应的触发器
     * @param text 文档文本
     * @param path 当前JSON路径
     */
    private getCurrentTrigger(text: string, path: (string | number)[]): string | null {
        const criteriaKey = path[1] as string;
        const parsedDoc = jsonc.parse(text);
        const criteriaNode = parsedDoc?.criteria?.[criteriaKey];
        return criteriaNode?.trigger || null;
    }

    /**
     * 为指定触发器创建补全项
     * @param trigger 触发器ID
     */
    private createCompletionItems(trigger: string): vscode.CompletionItem[] {
        return this.triggerConditions[trigger].fields.map(field => {
            const item = new vscode.CompletionItem(
                field.name,
                vscode.CompletionItemKind.Property
            );

            // 补全文本（带示例值）
            item.insertText = new vscode.SnippetString(`${field.name}: ${field.example}`);

            // 文档说明（含必填标识）
            item.documentation = new vscode.MarkdownString(
                `${field.description}\n\n${field.required ? "**必填字段**" : "可选字段"}`
            );

            // 优先级（必填字段优先显示）
            item.sortText = field.required ? "0" : "1";

            return item;
        });
    }
}

// 类型定义
interface TriggerCondition {
    fields: Array<{
        name: string;          // 条件字段名
        required: boolean;     // 是否必填
        example: string;       // 示例值
        description: string;   // 描述
    }>;
}