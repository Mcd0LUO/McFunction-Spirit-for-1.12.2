import * as vscode from 'vscode';
import * as fs from 'fs/promises'; // 改用异步API
import * as fss from 'fs'; // 导入同步API
import * as path from 'path';
import { CommandRegistry } from './core/CommandRegistry';
import { MainCompletionProvider } from './core/MainCompletionProvider';
import { LinkProvider } from './core/LinkProvider';
import { DataLoader } from './core/DataLoader';
import { FileLineIdleSearchProcessor } from './core/FileLineIdleSearchProcessor';
import { join } from 'path';
import { LinePreviewManager } from './previewer/LinePreviewManager';
import { FileLineCorrection } from './correction/FileLineCorrection';


// 全局定时器引用，用于插件停用时分销
let scanTimer: NodeJS.Timeout | undefined;

/**
 * 插件激活函数
 * 当插件被激活时调用此函数，用于初始化各种功能
 * @param context VS Code扩展上下文
 */
export async function activate(context: vscode.ExtensionContext) {
    // 初始化数据加载器
    await DataLoader.initialize(context);

    // 注册代码补全提供者
    const provider = vscode.languages.registerCompletionItemProvider(
        'mcfunction',
        new MainCompletionProvider(),
        ' ', '[', ',', '=', '_', '{'
    );
    context.subscriptions.push(provider);

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('mcfunction.createFunctionFile', createFunctionFile),
        vscode.commands.registerCommand('mcfunction.keyCreateFunctionFile', keyCreateFunctionFile),
        vscode.commands.registerCommand('mcfunction.reloadFunction', onReloadFunction(context))
    );

    // 注册文档链接提供者
    const selector: vscode.DocumentSelector = { language: 'mcfunction' };
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(selector, new LinkProvider())
    );

    // 创建文件系统监视器（优化：仅监听函数目录，减少监听范围）
    const functionDir = DataLoader.getfunctionDirectory();
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(functionDir, '**/*.mcfunction'),
        false, false, false // 不监听文件夹创建/删除/重命名
    );
    context.subscriptions.push(watcher);

    // 监听文件事件（优化：增加节流处理）
    const fileProcessor = createThrottledProcessor(handleFileChange, 1000);
    watcher.onDidCreate(uri => fileProcessor(uri, 'create'));
    watcher.onDidDelete(uri => fileProcessor(uri, 'delete'));
    watcher.onDidChange(uri => fileProcessor(uri, 'change'));

    // 自动注册命令提供者（优化：改用异步读取）
    await autoRegisterProviders(context);

    // 初始化FileLine处理器
    const lineProcessor = FileLineIdleSearchProcessor.getInstance();

    // 优化定时任务：可配置扫描间隔，默认3分钟
    const config = vscode.workspace.getConfiguration('mcfunction');
    const scanInterval = config.get<number>('scanInterval', 180) * 1000;
    scanTimer = setInterval(() => {
        // 仅在非活跃编辑状态下执行扫描
        if (!vscode.window.activeTextEditor) {
            lineProcessor.process().catch(err =>
                console.error('定时扫描失败:', err)
            );
        }
    }, scanInterval);
    context.subscriptions.push({ dispose: () => clearInterval(scanTimer) });

    // 文档事件监听（优化：精细化处理范围）
    const documentSubscriptions = [
        // 打开文档：延迟扫描，避免启动时资源竞争
        vscode.workspace.onDidOpenTextDocument(async document => {
            if (document.languageId === 'mcfunction') {
                await delay(500); // 延迟500ms执行
                await lineProcessor.scanActiveDocument(document);
            }
        }),

        // 文本变更：增加防抖，合并短时间内的多次变更
        createDebouncedListener(vscode.workspace.onDidChangeTextDocument, (event) => {
            if (event.document.languageId !== 'mcfunction') {return;}
            handleTextChanges(event, lineProcessor);
        }, 300),

        // 保存文档：仅在内容有实际变更时扫描
        vscode.workspace.onDidSaveTextDocument(async document => {
            if (document.languageId === 'mcfunction' && document.isDirty) {
                await lineProcessor.scanActiveDocument(document);
            }
        }),

        // 关闭文档：立即清理但不阻塞UI
        vscode.workspace.onDidCloseTextDocument(document => {
            if (document.languageId === 'mcfunction') {
                // 异步清理，避免阻塞关闭操作
                queueMicrotask(() => {
                    lineProcessor.handleDocumentClose(document);
                });
            }
        })
    ];

    context.subscriptions.push(...documentSubscriptions);
    // 预览
    // 实例化命令预览器并激活
    const jsonPreviewer = new LinePreviewManager();
    context.subscriptions.push(jsonPreviewer);

    // 注册错误处理器
    // 初始化并启动错误检查器
    const lineCorrection = FileLineCorrection.instance;
    lineCorrection.start();
    context.subscriptions.push(lineCorrection);


}

/**
 * 处理文件系统变化（合并创建/删除/修改逻辑）
 */
async function handleFileChange(uri: vscode.Uri, type: 'create' | 'delete' | 'change') {
    const config = DataLoader.getConfig();
    const ignoreDirs = config["ignore-function-directory"] || [];
    const filePath = uri.fsPath;

    // 检查是否需要忽略
    if (ignoreDirs.some(dir => filePath.includes(`data${path.sep}functions${path.sep}${dir}`))) {
        return;
    }

    const relativePath = DataLoader.getRelativeFunctionPath(filePath);
    if (!relativePath) {return;}

    switch (type) {
        case 'create':
            DataLoader.addFunctionPath(relativePath);
            vscode.window.showInformationMessage(`已添加函数文件: ${relativePath}`);
            break;
        case 'delete':
            DataLoader.removeFunctionPath(relativePath);
            break;
        case 'change':
            // 仅当文件内容变更时重新扫描（避免元数据变化触发）
            const processor = FileLineIdleSearchProcessor.getInstance();
            await processor.scanSingleFile(filePath);
            break;
    }
}

/**
 * 处理文本变更事件（优化解析逻辑）
 */
function handleTextChanges(event: vscode.TextDocumentChangeEvent, processor: FileLineIdleSearchProcessor) {
    const document = event.document;
    const changes = event.contentChanges;

    // 快速过滤：无实质内容变更则跳过
    if (changes.every(change => change.text.trim() === '' && change.rangeLength === 0)) {
        return;
    }

    changes.forEach(change => {
        const startLine = change.range.start.line;
        const endLine = change.range.end.line;

        // 优化：只处理包含关键字的行（减少解析量）
        for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
            if (lineNumber >= document.lineCount) {continue;}
            const lineText = document.lineAt(lineNumber).text;

            // 仅处理可能包含tag/scoreboard的行
            if (lineText.includes('scoreboard') || lineText.includes('tag=')) {
                processor.processLineUpdate(document, lineNumber, lineText);
            }
        }
    });
}

/**
 * 重新加载函数的处理函数（优化反馈）
 */
function onReloadFunction(context: vscode.ExtensionContext) {
    return async () => {
        // 显示加载状态
        const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        statusBar.text = '$(sync~spin) 正在加载函数...';
        statusBar.show();

        try {
            await DataLoader.loadAllData(context);
            await FileLineIdleSearchProcessor.getInstance().process();

            // 优化反馈信息：分类型显示
            const stats = [
                `函数: ${DataLoader.getFunctionPaths().length}`,
                `进度: ${DataLoader.getAdvancementPaths().length}`,
                `记分板: ${FileLineIdleSearchProcessor.SCOREBOARDS.size}`
            ];
            vscode.window.showInformationMessage(`加载完成 | ${stats.join(' | ')}`);
        } catch (err) {
            vscode.window.showErrorMessage(`加载失败: ${(err as Error).message}`);
        } finally {
            statusBar.dispose();
        }
    };
}

/**
 * 自动注册命令提供者（优化：异步加载）
 */
async function autoRegisterProviders(context: vscode.ExtensionContext) {
    const providerDir = join(context.extensionPath, 'out', 'completionProvider');
    try {
        // 异步读取目录，避免阻塞
        const files = await fs.readdir(providerDir);
        for (const file of files) {
            if (file.endsWith('CompletionProvider.js')) {
                const providerName = file.slice(0, -21);
                // 动态导入改为异步
                const module = await import(`./completionProvider/${providerName}CompletionProvider`);
                const providerClass = module[`${providerName}CompletionProvider`];
                if (providerClass) {
                    CommandRegistry.register(providerName.toLowerCase(), new providerClass());
                }
            }
        }
    } catch (error) {
        console.error('自动注册命令提供者时出错：', error);
    }
}

/**
 * 创建函数文件
 * @param uri 目标目录的URI
 */
async function createFunctionFile(uri: vscode.Uri): Promise<void> {
    // 检查是否打开了工作区
    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('请先打开一个工作区文件夹');
        return;
    }

    const targetDir: string = uri.fsPath;
    const config: Record<string, any> = DataLoader.getConfig();
    const ignoreDirs: string[] = config["ignore-function-directory"] || [];

    // 显示输入框，获取用户输入的文件名
    const fileName: string | undefined = await vscode.window.showInputBox({
        placeHolder: '输入文件名（不需要后缀）',
        prompt: '创建新的MCFunction文件',
        validateInput: (value: string): string | null => {
            if (!value) {
                return '文件名不能为空';
            }
            if (/[<>:"/\\|?*]/.test(value)) {
                return '文件名包含无效字符';
            }
            if (fss.existsSync(path.join(targetDir, `${value}.mcfunction`))) {
                return '文件已存在';
            }
            return null;
        }
    });

    if (!fileName) {
        return;
    }

    // 创建文件
    const filePath: string = path.join(targetDir, `${fileName}.mcfunction`);
    const fileUri: vscode.Uri = vscode.Uri.file(filePath);

    try {
        // 写入空文件并打开
        await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);

        // 将新文件添加到函数路径列表中
        const relativePath: string | undefined = DataLoader.getRelativeFunctionPath(fileUri.fsPath) ?? undefined;
        if (relativePath && !ignoreDirs.some(dir => relativePath.includes(dir))) {
            DataLoader.addFunctionPath(relativePath);
        }

        vscode.window.showInformationMessage(`已创建函数文件: ${fileName}.mcfunction`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`创建文件失败: ${errorMessage}`);
    }
}

/**
 * 通过快捷键创建函数文件
 */
async function keyCreateFunctionFile(): Promise<void> {
    // 检查是否打开了工作区
    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('请先打开一个工作区文件夹');
        return;
    }

    let targetDir: string | undefined;

    try {
        // 尝试从资源管理器中获取选中的目录
        // 注意：访问私有属性可能在未来版本中失效，这里仅为兼容原逻辑
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(__dirname));
        const explorerService: any = workspaceFolder
            ? (workspaceFolder as any)._workspace?._explorerService
            : undefined;

        if (explorerService && explorerService.selection) {
            const selectedItems: vscode.Uri[] = explorerService.selection;
            if (selectedItems.length > 0) {
                const firstSelected: vscode.Uri = selectedItems[0];
                const stats: vscode.FileStat = await vscode.workspace.fs.stat(firstSelected);

                if (stats.type & vscode.FileType.Directory) {
                    targetDir = firstSelected.fsPath;
                } else {
                    targetDir = path.dirname(firstSelected.fsPath);
                }
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`通过工作区获取选中文件夹失败: ${errorMessage}, 无法创建函数`);
    }

    // 如果没有从资源管理器获取到目录，则尝试从活动编辑器获取
    if (!targetDir && vscode.window.activeTextEditor) {
        const activeFile: vscode.Uri = vscode.window.activeTextEditor.document.uri;
        targetDir = path.dirname(activeFile.fsPath);
    }

    // 如果仍然没有获取到目录，则使用工作区根目录
    if (!targetDir) {
        targetDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }

    await createFunctionFile(vscode.Uri.file(targetDir));
}


// 工具函数：防抖
function createDebouncedListener<T extends (...args: any[]) => void>(
    listener: (callback: T) => vscode.Disposable,
    callback: T,
    delay: number
): vscode.Disposable {
    let timeout: NodeJS.Timeout | undefined;
    const debounced = (...args: Parameters<T>) => {
        if (timeout) {clearTimeout(timeout);}
        timeout = setTimeout(() => callback(...args), delay);
    };
    const disposable = listener(debounced as T);
    return {
        dispose: () => {
            disposable.dispose();
            if (timeout) {clearTimeout(timeout);}
        }
    };
}

// 工具函数：节流
function createThrottledProcessor<T extends (...args: any[]) => void>(
    processor: T,
    interval: number
): T {
    let lastProcessed = 0;
    return ((...args: Parameters<T>) => {
        const now = Date.now();
        if (now - lastProcessed >= interval) {
            processor(...args);
            lastProcessed = now;
        }
    }) as T;
}

// 工具函数：延迟执行
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/**
 * 插件停用函数（优化：完善清理逻辑）
 */
export function deactivate() {
    if (scanTimer) {
        clearInterval(scanTimer);
    }
    // 清理FileLine处理器缓存
    FileLineIdleSearchProcessor.getInstance().clearAllCaches();
}