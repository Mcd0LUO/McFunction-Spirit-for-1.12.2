import * as vscode from 'vscode';
import { MinecraftCommandCompletionProvider } from '../core/CommandCompletionProvider';

/**
 * 实体NBT补全项定义接口
 */
interface EntityNBTDefinition {
    label: string;
    detail: string;
    insertText: string;
}

/**
 * 方块NBT补全项定义接口
 */
interface BlockNBTDefinition {
    label: string;
    description: string;
    insertText: string;
    isOptional: boolean;
}

/**
 * NBT工具类
 * 提供实体和方块的NBT标签补全功能
 */
export class NBTUtils {
    /**
     * 实体NBT补全项定义表
     */
    private static readonly ENTITY_NBT_DEFINITIONS: EntityNBTDefinition[] = [
        // 通用实体NBT标签
        { label: 'CustomName', detail: '实体显示的自定义名称 : string', insertText: 'CustomName:"${1:}"'},
        { label: 'CustomNameVisible', detail: '始终显示自定义名称 : bool', insertText: 'CustomNameVisible:${1|0,1|}b'},
        { label: 'NoAI', detail: '禁用实体AI : bool', insertText: 'NoAI:${1|0,1|}b'},
        { label: 'Silent', detail: '实体不会发出声音: bool', insertText: 'Silent${1|0,1|}b'},
        { label: 'Invulnerable', detail: '实体不会受到伤害: bool', insertText: 'Invulnerable:${1|0,1|}b'},
        { label: 'PersistenceRequired', detail: '不会自然刷新: bool', insertText: 'PersistenceRequired:${1|0,1|}b'},
        { label: 'Tags', detail: '实体的标签列表', insertText: 'Tags:["${1:}"]'},
        { label: 'UUIDMost', detail: '实体的UUID最高位', insertText: 'UUIDMost:${1:}'},
        { label: 'UUIDLeast', detail: '实体的UUID最低位', insertText: 'UUIDLeast:${1:}'},
        { label: 'id', detail: '生物的类型id [命名空间:名称]', insertText: 'id:"${1:}"'},
        { label: 'Team', detail: '实体所属的团队名称', insertText: 'Team:"${1:}"'},
        
        // 生物相关NBT标签
        { label: 'Health', detail: '实体当前生命值: <= 1024', insertText: 'Health:${1:}'},
        { label: 'AbsorptionAmount', detail: '实体当前吸收生命值', insertText: 'AbsorptionAmount:${1:}'},
        { label: 'FallDistance', detail: '实体坠落的距离', insertText: 'FallDistance:${1:}'},
        { label: 'Fire', detail: '实体着火剩余时间(刻)', insertText: 'Fire:${1:}'},
        { label: 'Air', detail: '实体在水中的剩余氧气时间(刻)', insertText: 'Air:${1:}'},
        { label: 'OnGround', detail: '实体是否在地面上', insertText: 'OnGround:${1|0,1|}b'},
        { label: 'Dimension', detail: '实体所在维度', insertText: 'Dimension:${1|0,-1,1|}'},
        { label: 'PortalCooldown', detail: '实体进入传送门冷却时间(刻)', insertText: 'PortalCooldown:${1:}'},
        { label: 'Rotation', detail: '实体的旋转角度(0-360)', insertText: 'Rotation:${1:}f'},
        { label: 'Motion', detail: '实体的移动速度(X,Y,Z)', insertText: 'Motion:[${1:}d,${2:}d,${3:}d]'},
        { label: 'OnFire', detail: '实体是否着火', insertText: 'OnFire:${1|0,1|}b'},
        { label: 'NoGravity', detail: '实体是否无重力', insertText: 'NoGravity:${1|0,1|}b'},
        { label: 'CanPickUpLoot', detail: '实体是否可以拾取战利品', insertText: 'CanPickUpLoot:${1|0,1|}b'},
        { label: 'Glowing', detail: '实体是否发光', insertText: 'Glowing:${1|0,1|}b'},
        { label: 'HurtTime', detail: '实体上一次受伤的时间(刻) <= 10', insertText: 'HurtTime:${1:}s'},
        { label: 'Marker', detail: '实体是否为标记[Armor]', insertText: 'Marker:${1|0,1|}b'},
        { label: 'Passengers', detail: '实体的乘客列表', insertText: 'Passengers:[{}]'},
        { label: 'Attributes', detail: '实体的属性列表', insertText: 'Attributes:[${1:}]'},
        { label: 'DeathLootTable', detail: '战利品表路径', insertText: 'DeathLootTable:"${1:}"'},
        // 装备相关NBT标签
        { label: 'ArmorItems', detail: '实体的盔甲物品列表', insertText: 'ArmorItems:[{Slot:${1:},id:"${2:}",Count:${3:},Damage:${4:}}]'},
        { label: 'HandItems', detail: '实体手持的物品列表', insertText: 'HandItems:[{},{}]'},
        { label: 'ArmorDropChances', detail: '实体的盔甲掉落概率列表', insertText: 'ArmorDropChances:[${1:}f,${2:}f,${3:}f,${4:}f]'}
    ];

    /**
     * 方块NBT补全项定义表
     */
    private static readonly BLOCK_NBT_DEFINITIONS: BlockNBTDefinition[] = [
        // 通用方块实体NBT标签
        { label: 'CustomName', description: '方块实体显示的自定义名称', insertText: '"${1:名称}"', isOptional: false},
        { label: 'Lock', description: '用于锁定容器的密码', insertText: '"${1:密码}"', isOptional: false},
        
        // 容器相关NBT标签(箱子、熔炉等)
        { label: 'Items', description: '容器中的物品', insertText: '[{Slot:${1:槽位},id:"${2:物品ID}",Count:${3:数量},Damage:${4:耐久}}]', isOptional: false},
        { label: 'LootTable', description: '战利品表路径', insertText: '"${1:战利品表路径}"', isOptional: false},
        
        // 特殊方块NBT标签
        { label: 'Text1', description: '告示牌第一行文本', insertText: '"${1:文本}"', isOptional: false},
        { label: 'Text2', description: '告示牌第二行文本', insertText: '"${1:文本}"', isOptional: false},
        { label: 'Text3', description: '告示牌第三行文本', insertText: '"${1:文本}"', isOptional: false},
        { label: 'Text4', description: '告示牌第四行文本', insertText: '"${1:文本}"', isOptional: false}
    ];

    /**
     * 提供实体NBT补全项
     * @param createCompletionItem 补全项创建函数
     * @returns 实体NBT补全项数组
     */
    static provideEntityNBTCompletions(
        createCompletionItem: (
            label: string,
            detail: string,
            insertText: string,
            triggerNext: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        return this.ENTITY_NBT_DEFINITIONS.map(def => 
            createCompletionItem(def.label, def.detail, def.insertText, false, vscode.CompletionItemKind.Property)
        );
    }

    /**
     * 提供方块NBT补全项
     * @param createCompletionItem 补全项创建函数
     * @returns 方块NBT补全项数组
     */
    static provideBlockNBTCompletions(
        createCompletionItem: (
            label: string,
            description: string,
            insertText: string,
            isOptional: boolean,
            kind: vscode.CompletionItemKind
        ) => vscode.CompletionItem
    ): vscode.CompletionItem[] {
        return this.BLOCK_NBT_DEFINITIONS.map(def => 
            createCompletionItem(def.label, def.description, def.insertText, def.isOptional, vscode.CompletionItemKind.Property)
        );
    }
}