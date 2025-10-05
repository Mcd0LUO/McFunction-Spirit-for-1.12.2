import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { MinecraftCommandCompletionProvider } from './CommandCompletionProvider';
import { FileLineIdleSearchProcessor } from './FileLineIdleSearchProcessor';

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

export interface HelperConfig {
    "ignore-function-directory"?: string[];
    "ignore-advancement-directory"?: string[];
    "scoreboards-name-container"?: string[];
    "space-auto-add"?: boolean;
    "check-data-exists"?: true,
    "check-scoreboard-length"?: true

}

export class DataLoader {
    private static instance: DataLoader;
    private config: HelperConfig = {};
    private functionPaths: string[] = [];
    private scoreboardMap: Record<string, [string, string]> = {};
    private configPath: string = '';
    private functionsDir: string = '';
    private advancementDir: string = '';
    private advancementPaths: string[] = [];
    private is_suffix_space: boolean = false;
    private is_check_data_exists: boolean = false;
    private is_check_scoreboard_length: boolean = false;
    // 定义必需的配置项
    // 定义必需的配置项
    public requiredKeys: string[] = [
        'ignore-function-directory',
        'ignore-advancement-directory',
        'space-auto-add',
        'check-data-exists',
        'check-scoreboard-length'

    ];


    private constructor() { }

    public static async initialize(context: vscode.ExtensionContext): Promise<DataLoader> {
        if (!this.instance) {
            this.instance = new DataLoader();
            await this.instance.setup(context);

        }
        return this.instance;

    }

    public static getConfig(): HelperConfig {
        return this.instance?.config || {};
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



    private async setup(context: vscode.ExtensionContext): Promise<void> {
        if (!vscode.workspace.workspaceFolders) { return; }
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        this.configPath = path.join(workspaceRoot, 'HelperConfig.json');
        this.functionsDir = path.join(workspaceRoot, 'functions');
        this.advancementDir = path.join(workspaceRoot, 'advancements');
        this.is_suffix_space = this.config["space-auto-add"] ?? true;
        this.is_check_data_exists = this.config["check-data-exists"] ?? true;
        this.is_check_scoreboard_length = this.config["check-scoreboard-length"] ?? true;

        await this.ensureConfigFile(context);
        await this.loadConfig();
        await this.loadFunctionPaths();
        // await this.loadScoreboard();
        await this.loadAdvancementPaths();
        // 初始化文件行空闲搜索处理器
        const fileLineIdleSearchProcessor = FileLineIdleSearchProcessor.getInstance();
        fileLineIdleSearchProcessor.start();
        // 初始化命令补全后缀
        MinecraftCommandCompletionProvider.global_sufiix = this.config["space-auto-add"] !== false ? " " : "";
        vscode.window.showInformationMessage(`加载函数 ${this.advancementPaths.length} 个|进度 ${this.functionPaths.length} 个 | 记分板加载中...`);

    }

    private async ensureConfigFile(context: vscode.ExtensionContext): Promise<void> {
        if (!fs.existsSync(this.configPath)) {

            try {
                await fs.promises.copyFile(path.join(context.extensionPath, 'out', 'HelperConfig.json'), this.configPath);

                vscode.window.showInformationMessage('已创建默认配置文件 HelperConfig.json');
            } catch (error) {
                vscode.window.showErrorMessage(`创建配置文件失败: ${error}`);
            }
        }
    }

    private async loadConfig(): Promise<void> {
        // 首先从HelperConfig.json文件中加载配置
        let fileConfig: HelperConfig = {};
        try {
            const data = await readFile(this.configPath, 'utf8');
            const parsedConfig = JSON.parse(data);
            

            
            // 检查是否有缺失的键
            let configChanged = false;
            const newConfig: Record<string, any> = {};
            
            // 复制必需的键值到新配置对象
            for (const key of this.requiredKeys) {
                if (parsedConfig.hasOwnProperty(key)) {
                    newConfig[key] = parsedConfig[key];
                } else {
                    // 添加缺失的键并设置默认值
                    switch (key) {
                        case 'ignore-function-directory':
                        case 'ignore-advancement-directory':
                            newConfig[key] = [];
                            configChanged = true;
                            break;
                        case 'space-auto-add':
                            newConfig[key] = true;
                            configChanged = true;
                            break;
                        case 'check-data-exists':
                            newConfig[key] = true;
                            configChanged = true;
                            break;
                        case 'check-scoreboard-length':
                            newConfig[key] = true;
                            configChanged = true;
                            break;
                    }
                }
            }
            
            
            fileConfig = newConfig as HelperConfig;
            
            // 如果配置有变化，则保存到文件
            if (configChanged) {
                try {
                    const configData = JSON.stringify(fileConfig, null, 4);
                    await writeFile(this.configPath, configData, 'utf8');
                    vscode.window.showInformationMessage('配置文件已更新并保存');
                } catch (saveError) {
                    vscode.window.showErrorMessage(`保存配置文件失败: ${saveError}`);
                }
            }

        } catch (error) {
            vscode.window.showErrorMessage(`读取配置文件失败: ${error}`);
            fileConfig = {
                "ignore-function-directory": [],
                "ignore-advancement-directory": [],
                "space-auto-add": true
            } as HelperConfig;
        }
        
        this.config = fileConfig;
    }

    private async loadFunctionPaths(): Promise<void> {
        this.functionPaths = [];


        if (!fs.existsSync(this.functionsDir)) {
            vscode.window.showErrorMessage(`函数目录不存在: ${this.functionsDir}`);
            return;
        }

        const ignoreDirs = this.config["ignore-function-directory"] || [];
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
            // console.log(files.forEach(file => console.log(file.fsPath)));

            // vscode.window.showInformationMessage(`已加载 ${this.functionPaths.length} 个函数文件`);
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

        const ignoreDirs = this.config["ignore-advancement-directory"] || [];
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


    private getRelativeAdvPath(fullPath: string): string | null {
        const normalizedPath = fullPath.replace(/\\/g, '/');
        const basePath = this.advancementDir.replace(/\\/g, '/') + '/';
        return normalizedPath.substring(basePath.length);

    }

    private getRelativeFuncPath(fullPath: string): string | null {
        const normalizedPath = fullPath.replace(/\\/g, '/');
        const basePath = this.functionsDir.replace(/\\/g, '/') + '/';

        return normalizedPath.substring(basePath.length);

    }

    public static async loadAllData(context: vscode.ExtensionContext): Promise<void> {
        if (this.instance) {
            await this.instance.ensureConfigFile(context);
            await this.instance.loadConfig();
            await this.instance.loadFunctionPaths();
            // await this.instance.loadScoreboard();
            MinecraftCommandCompletionProvider.global_sufiix = this.instance.config["space-auto-add"] !== false ? " " : "";
        }
    }

    public static getfunctionDirectory(): string {
        return this.instance ? this.instance.functionsDir : '';
    }

    /**
     * 根据不同类型写入配置并保存到文件中
     * @param type 配置类型
     * @param value 配置值
     */
    public static async updateConfig(type: keyof HelperConfig, value: any): Promise<void> {
        if (!this.instance) {
            throw new Error('DataLoader未初始化');
        }

        // 更新内存中的配置
        this.instance.config[type] = value;

        // 保存到文件
        try {
            const configData = JSON.stringify(this.instance.config, null, 4);
            await writeFile(this.instance.configPath, configData, 'utf8');
        } catch (error) {
            vscode.window.showErrorMessage(`保存配置文件失败: ${error}`);
            throw error;
        }
    }

    /**
     * 向数组类型的配置项中添加值
     * @param type 配置类型（数组类型）
     * @param value 要添加的值
     */
    public static async addToConfigArray(type: keyof HelperConfig, value: string): Promise<void> {
        if (!this.instance) {
            throw new Error('DataLoader未初始化');
        }

        // 确保配置项是数组类型
        if (!Array.isArray(this.instance.config[type])) {
            (this.instance.config as any)[type] = [];
        }

        // 检查是否已存在该值
        const arrayConfig = this.instance.config[type] as string[];
        if (!arrayConfig.includes(value)) {
            arrayConfig.push(value);
            
            // 保存到文件
            try {
                const configData = JSON.stringify(this.instance.config, null, 4);
                await writeFile(this.instance.configPath, configData, 'utf8');
            } catch (error) {
                vscode.window.showErrorMessage(`保存配置文件失败: ${error}`);
                throw error;
            }
        }
    }

    /**
     * 从数组类型的配置项中移除值
     * @param type 配置类型（数组类型）
     * @param value 要移除的值
     */
    public static async removeFromConfigArray(type: keyof HelperConfig, value: string): Promise<void> {
        if (!this.instance) {
            throw new Error('DataLoader未初始化');
        }

        // 确保配置项是数组类型
        if (!Array.isArray(this.instance.config[type])) {
            (this.instance.config as any)[type] = [];
            return;
        }

        // 移除指定值
        const arrayConfig = this.instance.config[type] as string[];
        const index = arrayConfig.indexOf(value);
        if (index !== -1) {
            arrayConfig.splice(index, 1);
            
            // 保存到文件
            try {
                const configData = JSON.stringify(this.instance.config, null, 4);
                await writeFile(this.instance.configPath, configData, 'utf8');
            } catch (error) {
                vscode.window.showErrorMessage(`保存配置文件失败: ${error}`);
                throw error;
            }
        }
    }

}