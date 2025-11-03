import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DataLoader } from './DataLoader';
import { DocumentManager } from './DocumentManager';
import { MinecraftUtils } from '../utils/MinecraftUtils';




/**
 * 文件行空闲扫描处理器
 * 负责后台扫描所有 .mcfunction 文件，提取 scoreboard 相关的标签(tag)和目标(objective)信息
 * 为命令补全、语法校验等功能提供数据支持，采用单例模式确保全局唯一实例
 */
export class FileLineIdleSearchProcessor {
    /** 目标关键字：仅处理包含 "scoreboard" 命令的文件，减少非必要扫描 */
    public static readonly TARGET_KEYWORD = 'scoreboard';
    /** 最大扫描文件大小（1MB）：避免超大文件导致的性能问题 */
    public static readonly MAX_SCANNED_FILE_SIZE = 1024 * 1024;

    /** 全局标签集合：存储所有扫描到的 scoreboard tag 名称 */
    public static TAGS: Map<string, number> = new Map();
    /** 全局计分板映射：存储计分板目标名称与 [类型, 显示名, 创建uri, 创建引用计数] 的映射关系 */
    public static SCOREBOARDS: Map<string, [string, string, vscode.Uri, number]> = new Map();

    /** 单例实例：确保全局只有一个扫描处理器实例，避免重复扫描 */
    private static instance: FileLineIdleSearchProcessor;

    /** 
     * 文件行-标签映射：记录每个文件中哪些行定义了标签
     * 键为文件URI字符串，值为行号与标签的映射（用于后续更新/清理）
     */
    private fileLineTagMap: Map<string, Map<number, string>> = new Map();
    /** 
     * 文件行-计分板映射：记录每个文件中哪些行定义了计分板
     * 键为文件URI字符串，值为行号与计分板目标的映射（用于后续更新/清理）
     */
    private fileLineScoreboardMap: Map<string, Map<number, string>> = new Map();
    /** 扫描完成标识：用于标记是否完成初始全量扫描，供外部判断数据是否可用 */
    public static isScanCompleted = false;

    /**
     * 获取单例实例
     * 确保全局只有一个处理器实例，避免重复注册事件和扫描
     * @returns FileLineIdleSearchProcessor 单例
     */
    public static getInstance(): FileLineIdleSearchProcessor {
        if (!FileLineIdleSearchProcessor.instance) {
            FileLineIdleSearchProcessor.instance = new FileLineIdleSearchProcessor();
        }
        return FileLineIdleSearchProcessor.instance;
    }

    /**
     * 私有构造函数
     * 阻止外部通过 new 实例化，强制使用单例模式
     */
    private constructor() { }

    /**
     * 启动初始全量扫描
     * 触发对工作区所有 .mcfunction 文件的扫描，加载初始标签和计分板数据
     */
    public async start(): Promise<void> {
        const startTime = Date.now();

        await this.process().catch(err => {
            vscode.window.showErrorMessage(`文件扫描失败：${err.message}`);
            console.error('FileLineIdleSearchProcessor 扫描异常：', err);
        });
        const endTime = Date.now();
        console.log(`文件扫描完成，耗时${(endTime - startTime) / 1000}秒`);
        
    }

    /**
     * 执行全量扫描逻辑
     * 检查工作区有效性、验证函数目录存在性、批量扫描所有 .mcfunction 文件
     * @returns 是否扫描成功
     */
    public async process(): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            vscode.window.showWarningMessage('未检测到打开的工作区，无法执行文件扫描');
            return false;
        }

        // 获取函数文件根目录（基于DataLoader的配置）
        const fullFunctionRoot = path.join(DataLoader.getfunctionDirectory());
        try {
            // 验证目录是否存在
            await fs.access(fullFunctionRoot, fs.constants.F_OK);
        } catch {
            vscode.window.showErrorMessage(`.mcfunction 根目录不存在：${fullFunctionRoot}`);
            return false;
        }

        // 获取所有函数文件路径
        const functionPaths = await MinecraftUtils.getAllFunctionPaths();
        if (functionPaths.length === 0) {
            vscode.window.showInformationMessage('未找到任何待扫描的 .mcfunction 文件');
            return true;
        }

        // 扫描前清理旧缓存
        this.clearAllCaches();

        // 并发扫描（限制并发数为5，避免IO压力过大）
        const concurrencyLimit = 5;
        for (let i = 0; i < functionPaths.length; i += concurrencyLimit) {
            const batch = functionPaths.slice(i, i + concurrencyLimit);
            await Promise.all(
                batch.map(funcPath => this.scanSingleFile(funcPath.fsPath))
            );
        }
        // 标记扫描完成
        FileLineIdleSearchProcessor.isScanCompleted = true;

        return true;
    }

    /**
     * 处理文档文本变更（转发给DocumentManager）
     * 作为事件回调的适配层，将变更事件转发给文档管理器处理
     * @param event 文本文档变更事件
     */
    public handleTextChanges(event: vscode.TextDocumentChangeEvent) {
        DocumentManager.getInstance().handleDocumentChanges(event);
    }

    /**
     * 扫描单个 .mcfunction 文件
     * 读取文件内容，检查文件大小，通过DocumentManager解析提取标签和计分板
     * @param fullFilePath 文件绝对路径
     */
    public async scanSingleFile(fullFilePath: string): Promise<void> {
        try {
            // 检查文件大小，跳过超大文件
            const fileStats = await fs.stat(fullFilePath);
            if (fileStats.size > FileLineIdleSearchProcessor.MAX_SCANNED_FILE_SIZE) {
                console.warn(`跳过超大文件（${fileStats.size} 字节）：${fullFilePath}`);
                return;
            }

            // 读取文件内容（实际解析逻辑委托给DocumentManager）
            const uri = vscode.Uri.file(fullFilePath);
            const document = await vscode.workspace.openTextDocument(uri);
            await DocumentManager.getInstance().scanActiveDocument(document);

        } catch (err) {
            const error = err as Error;
            // 忽略文件不存在的错误（可能是临时文件或已删除）
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(`文件不存在，已跳过：${fullFilePath}`);
                return;
            }
            // 其他错误提示用户
            vscode.window.showWarningMessage(`扫描文件失败：${path.basename(fullFilePath)}，原因：${error.message}`);
            console.error(`扫描文件 ${fullFilePath} 异常：`, error);
        }
    }

    /**
     * 获取全局计分板数据
     * 提供外部访问计分板映射的接口（如补全提供者）
     * @returns 计分板名称与 [类型, 显示名] 的映射
     */
    public static getScoreboards(): Map<string, [string, string, vscode.Uri, number]> {
        return FileLineIdleSearchProcessor.SCOREBOARDS;
    }

    /**
     * 获取全局标签数据
     * 提供外部访问标签集合的接口（如补全提供者）
     * @returns 标签名称集合
     */
    public static getTags(): Map<string, number> {
        return FileLineIdleSearchProcessor.TAGS;
    }

    /**
     * 清理所有缓存数据
     * 包括文件行映射、全局标签和计分板集合，用于重新扫描前初始化
     */
    public clearAllCaches() {
        this.fileLineTagMap.clear();
        this.fileLineScoreboardMap.clear();
        FileLineIdleSearchProcessor.TAGS.clear();
        FileLineIdleSearchProcessor.SCOREBOARDS.clear();
        DocumentManager.getInstance().cleanupAllDocumentCache();
    }

    /**
     * 释放资源
     * 扩展卸载时调用，清理缓存避免内存泄漏
     */
    public dispose() {
        this.clearAllCaches();
    }
}
