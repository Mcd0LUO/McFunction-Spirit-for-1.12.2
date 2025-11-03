import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { MinecraftCommandCompletionProvider } from './CommandCompletionProvider';
import { FileLineIdleSearchProcessor } from './FileLineIdleSearchProcessor';

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

// ========== 统一配置定义（只维护一处） ==========
export interface HelperConfig {
    "ignore-function-directory"?: string[];
    "ignore-advancement-directory"?: string[];
    "space-auto-add"?: boolean;
    "check-data-exists"?: boolean; // 修正原类型错误（原写为true，应为boolean）
    "check-scoreboard-length"?: boolean; // 同上
    "json-message-block-preview"?: boolean;
    "json-message-hover-preview"?: boolean;
    "function-reference-preview"?: boolean;
    "file-link-provide"?: boolean;
}

// 统一默认配置（所有配置项的默认值集中维护）
const DEFAULT_CONFIG: Required<HelperConfig> = {
    "ignore-function-directory": [],
    "ignore-advancement-directory": [],
    "space-auto-add": true,
    "check-data-exists": true,
    "check-scoreboard-length": true,
    "json-message-block-preview": true,
    "json-message-hover-preview": true,
    "function-reference-preview": true,
    "file-link-provide": true
};

// ========== 简化的格式化工具（只保证数组换行格式） ==========
/** 格式化JSON：仅保留4空格缩进+数组换行格式 */
function formatConfigJson(config: Required<HelperConfig>): string {
    // JSON.stringify 自带数组换行逻辑：indent=4 时，数组会自动换行显示
    // 空数组格式："key": [
    // ]
    // 有元素数组："key": [
    //     "item1",
    //     "item2"
    // ]
    return JSON.stringify(config, null, 4) + '\n'; // 末尾添加一个空行（可选，增强可读性）
}

// 必需配置项（从默认配置自动推导，无需手动写数组）
const REQUIRED_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof HelperConfig)[];

// ========== DataLoader 类 ==========
export class DataLoader {
    private static instance: DataLoader;
    private config: Required<HelperConfig> = { ...DEFAULT_CONFIG }; // 初始化为默认配置
    private functionPaths: string[] = [];
    private scoreboardMap: Record<string, [string, string]> = {};
    private configPath: string = '';
    public functionsDir: string = '';
    private advancementDir: string = '';
    private advancementPaths: string[] = [];

    // 补充实例变量声明（原代码使用了但未定义）
    private is_suffix_space: boolean = DEFAULT_CONFIG["space-auto-add"];
    private is_check_data_exists: boolean = DEFAULT_CONFIG["check-data-exists"];
    private is_check_scoreboard_length: boolean = DEFAULT_CONFIG["check-scoreboard-length"];

    private constructor() { }

    // ========== 单例初始化 ==========
    public static async initialize(context: vscode.ExtensionContext): Promise<DataLoader> {
        if (!this.instance) {
            this.instance = new DataLoader();
            await this.instance.setup(context);
        }
        return this.instance;
    }

    // ========== 静态获取方法 ==========
    public static getConfig(): Required<HelperConfig> {
        return this.instance?.config || { ...DEFAULT_CONFIG };
    }

    public static getFunctionPaths(): string[] {
        return this.instance?.functionPaths || [];
    }

    public static getAdvancementPaths(): string[] {
        return this.instance?.advancementPaths || [];
    }

    public static getScoreboardMap(): Record<string, [string, string]> {
        return this.instance?.scoreboardMap || {};
    }

    public static addFunctionPath(path: string): void {
        if (this.instance && !this.instance.functionPaths.includes(path)) {
            this.instance.functionPaths.push(path);
        }
    }

    public static removeFunctionPath(path: string): void {
        if (this.instance) {
            this.instance.functionPaths = this.instance.functionPaths.filter(p => p !== path);
        }
    }

    public static getRelativeFunctionPath(fullPath: string): string | null {
        if (!this.instance) { return null; }

        const normalizedPath = fullPath.replace(/\\/g, '/');
        const functionsIndex = normalizedPath.indexOf('/data/functions/');

        if (functionsIndex === -1) {
            console.warn(`路径不在函数目录中: ${fullPath}`);
            return null;
        }

        return normalizedPath.substring(functionsIndex + 16);
    }

    // ========== 初始化流程 ==========
    private async setup(context: vscode.ExtensionContext): Promise<void> {
        if (!vscode.workspace.workspaceFolders) { return; }
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

        // 初始化路径
        this.configPath = path.join(workspaceRoot, 'HelperConfig.json');
        this.functionsDir = path.join(workspaceRoot, 'functions');
        this.advancementDir = path.join(workspaceRoot, 'advancements');

        // 初始化流程：确保配置文件 → 加载配置 → 加载数据
        await this.ensureConfigFile();
        await this.loadConfig();
        await this.loadFunctionPaths();
        await this.loadAdvancementPaths();

        // 初始化依赖组件
        FileLineIdleSearchProcessor.getInstance().start();
        MinecraftCommandCompletionProvider.global_sufiix = this.config["space-auto-add"] ? " " : "";

        // 更新实例变量（从配置同步）
        this.syncConfigToInstanceVars();

        vscode.window.showInformationMessage(
            `加载函数 ${this.functionPaths.length} 个|进度 ${this.advancementPaths.length} 个 | 记分板加载中...`
        );
    }

    // ========== 配置文件处理 ==========
    /** 确保配置文件存在（不存在则创建，使用统一默认配置） */
    private async ensureConfigFile(): Promise<void> {
        if (!fs.existsSync(this.configPath)) {
            try {
                const configData = JSON.stringify(DEFAULT_CONFIG, null, 4);
                await writeFile(this.configPath, configData, 'utf8');
                vscode.window.showInformationMessage('已创建默认配置文件 HelperConfig.json');
            } catch (error) {
                vscode.window.showErrorMessage(`创建配置文件失败: ${error}`);
            }
        }
    }

    /** 加载配置（自动补全缺失项，无需重复写默认值） */
    private async loadConfig(): Promise<void> {
        try {
            const data = await readFile(this.configPath, 'utf8');
            const parsedConfig = JSON.parse(data) as Partial<HelperConfig>;

            // 合并配置：用解析结果覆盖默认配置，缺失项自动补全
            const mergedConfig: Required<HelperConfig> = {
                ...DEFAULT_CONFIG,
                ...parsedConfig
            };

            // 检查是否有配置项被补全（需要保存到文件）
            const isConfigUpdated = REQUIRED_KEYS.some(
                key => !(key in parsedConfig)
            );

            // 保存更新后的配置（如果有缺失项被补全）
            if (isConfigUpdated) {
                await writeFile(this.configPath, JSON.stringify(mergedConfig, null, 4), 'utf8');
                vscode.window.showInformationMessage('配置文件已更新（补全缺失项）');
            }

            this.config = mergedConfig;
        } catch (error) {
            vscode.window.showErrorMessage(`读取配置文件失败，使用默认配置: ${error}`);
            this.config = { ...DEFAULT_CONFIG }; // 异常时回退到默认配置
        }
    }

    /** 同步配置到实例变量 */
    private syncConfigToInstanceVars(): void {
        this.is_suffix_space = this.config["space-auto-add"];
        this.is_check_data_exists = this.config["check-data-exists"];
        this.is_check_scoreboard_length = this.config["check-scoreboard-length"];
    }

    // ========== 数据加载 ==========
    private async loadFunctionPaths(): Promise<void> {
        this.functionPaths = [];

        if (!fs.existsSync(this.functionsDir)) {
            vscode.window.showErrorMessage(`函数目录不存在: ${this.functionsDir}`);
            return;
        }

        const ignoreDirs = this.config["ignore-function-directory"];
        const ignorePattern = ignoreDirs.length > 0
            ? `**/{${ignoreDirs.join(',')}}/**`
            : undefined;

        try {
            const files = await vscode.workspace.findFiles(
                'functions/**/*.mcfunction',
                ignorePattern
            );

            files.forEach(file => {
                const relativePath = this.getRelativeFuncPath(file.fsPath);
                if (relativePath) {
                    this.functionPaths.push(relativePath);
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`加载函数路径失败: ${error}`);
        }
    }

    private async loadAdvancementPaths(): Promise<void> {
        this.advancementPaths = [];

        if (!fs.existsSync(this.advancementDir)) {
            vscode.window.showErrorMessage(`进度目录不存在: ${this.advancementDir}`);
            return;
        }

        const ignoreDirs = this.config["ignore-advancement-directory"];
        const ignorePattern = ignoreDirs.length > 0
            ? `**/{${ignoreDirs.join(',')}}/**`
            : undefined;

        try {
            const files = await vscode.workspace.findFiles(
                'advancements/**/*.json',
                ignorePattern
            );

            files.forEach(file => {
                const relativePath = this.getRelativeAdvPath(file.fsPath);
                if (relativePath) {
                    this.advancementPaths.push(relativePath);
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`加载进度路径失败: ${error}`);
        }
    }

    // ========== 工具方法 ==========
    private getRelativeAdvPath(fullPath: string): string | null {
        const normalizedPath = fullPath.replace(/\\/g, '/');
        const basePath = this.advancementDir.replace(/\\/g, '/') + '/';
        return normalizedPath.startsWith(basePath)
            ? normalizedPath.substring(basePath.length)
            : null;
    }

    private getRelativeFuncPath(fullPath: string): string | null {
        const normalizedPath = fullPath.replace(/\\/g, '/');
        const basePath = this.functionsDir.replace(/\\/g, '/') + '/';
        return normalizedPath.startsWith(basePath)
            ? normalizedPath.substring(basePath.length)
            : null;
    }

    // ========== 静态工具方法 ==========
    public static async loadAllData(context: vscode.ExtensionContext): Promise<void> {
        if (this.instance) {
            await this.instance.ensureConfigFile();
            await this.instance.loadConfig();
            await this.instance.loadFunctionPaths();
            MinecraftCommandCompletionProvider.global_sufiix = this.instance.config["space-auto-add"] ? " " : "";
            this.instance.syncConfigToInstanceVars(); // 同步配置到实例变量
        }
    }

    public static getfunctionDirectory(): string {
        return this.instance ? this.instance.functionsDir : '';
    }

    /** 更新配置并保存 */
    public static async updateConfig(type: keyof HelperConfig, value: any): Promise<void> {
        if (!this.instance) {
            throw new Error('DataLoader未初始化');
        }

        this.instance.config[type] = value;
        await this.instance.saveConfig();
        this.instance.syncConfigToInstanceVars(); // 同步更新实例变量
    }

    /** 向数组类型配置项添加值 */
    public static async addToConfigArray(type: keyof HelperConfig, value: string): Promise<void> {
        if (!this.instance) {
            throw new Error('DataLoader未初始化');
        }

        // 确保配置项是数组类型
        const configItem = this.instance.config[type] as string[];
        if (!Array.isArray(configItem)) {
            this.instance.config[type] = [] as any;
        }

        if (!configItem.includes(value)) {
            configItem.push(value);
            await this.instance.saveConfig();
        }
    }

    /** 从数组类型配置项移除值 */
    public static async removeFromConfigArray(type: keyof HelperConfig, value: string): Promise<void> {
        if (!this.instance) {
            throw new Error('DataLoader未初始化');
        }

        const configItem = this.instance.config[type] as string[];
        if (Array.isArray(configItem)) {
            const index = configItem.indexOf(value);
            if (index !== -1) {
                configItem.splice(index, 1);
                await this.instance.saveConfig();
            }
        }
    }

    /** 统一保存配置文件（提取公共逻辑） */
    private async saveConfig(): Promise<void> {
        try {
            const formattedJson = formatConfigJson(this.config);
            await writeFile(this.configPath, formattedJson, 'utf8');
        } catch (error) {
            vscode.window.showErrorMessage(`保存配置文件失败: ${error}`);
            throw error;
        }
    }

}