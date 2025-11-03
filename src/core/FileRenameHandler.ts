import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileLineIdleSearchProcessor } from './FileLineIdleSearchProcessor';
import { DocumentManager } from './DocumentManager';
import { MinecraftUtils } from '../utils/MinecraftUtils';

export class FileRenameHandler {

    /** 初始化文件重命名事件监听 */
    init() {
        // 监听VS Code的文件重命名事件
        vscode.workspace.onDidRenameFiles(async (event) => {
            // 弹窗是否更新函数引用
            const updateReferences = await vscode.window.showQuickPick(
                ['是', '否'],
                { placeHolder: '是否重命名有关函数引用？' }
            );
            if (updateReferences !== '是') {return;};
            // 显示加载状态
            const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
            statusBar.text = '$(sync~spin) 正在重命名函数...';
            statusBar.show();
            for (const file of event.files) {
                await this.handleRename(file.oldUri, file.newUri);
            }
            statusBar.dispose();
        });
    }

    /** 处理单个文件/文件夹重命名 */
    public async handleRename(oldUri: vscode.Uri, newUri: vscode.Uri) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(oldUri);
        if (!workspaceFolder) {return;}
        if (!FileLineIdleSearchProcessor.isScanCompleted) {
            // 提示用户 正在扫描中
            vscode.window.showWarningMessage('正在扫描中，无法重命名,请稍等...');
            // 撤销重命名
            await vscode.commands.executeCommand('undo');
        }

        // 1. 解析旧路径和新路径（相对于工作区根目录）
        let isFile = false;
        // 2. 判断是文件还是文件夹
        try {
            const stat = await fs.statSync(newUri.fsPath);
            isFile = stat.isFile();
        } 
        catch (error) {
            console.error(`Error checking file type: ${error}`);
            return;
        }
        if (isFile) {
            await this.updateFunctionReferences(oldUri, newUri);
            await this.updateFunctionDispatches(oldUri, newUri);
        }
        else {
            // 处理文件夹重命名
            // 1. 获取旧文件夹和新文件夹的路径字符串
            const oldFolderPath = oldUri.fsPath;
            const newFolderPath = newUri.fsPath;

            // 2. 在新文件夹中查找所有函数文件（因为文件夹已经被重命名）
            const newGlobPattern = new vscode.RelativePattern(newUri, '**/*.mcfunction');
            const newFunctionUris = await vscode.workspace.findFiles(newGlobPattern);

            // 3. 为每个新找到的函数文件计算其旧URI，然后更新引用
            for (const newFunctionUri of newFunctionUris) {
                // 通过路径替换计算旧文件路径
                const newFilePath = newFunctionUri.fsPath;
                const oldFilePath = newFilePath.replace(newFolderPath, oldFolderPath);
                const oldFunctionUri = vscode.Uri.file(oldFilePath);

                // 更新该文件的引用
                await this.updateFunctionReferences(oldFunctionUri, newFunctionUri);
                await this.updateFunctionDispatches(oldFunctionUri, newFunctionUri);

                // 同时需要更新文档管理器中的键映射
                DocumentManager.getInstance().renameDocumentKey(
                    oldFunctionUri,
                    newFunctionUri
                );
            }
        }
    }

    /**
     *  更新函数引用
     * @param oldUri 旧文件路径
     * @param newUri  新文件路径
     * @returns void
     */
    private async updateFunctionReferences(oldUri: vscode.Uri, newUri: vscode.Uri) {
        if (!oldUri.fsPath.endsWith('.mcfunction')) { return; }
        // 更改本函数被引用的函数中对自身的调用
        const refferencedFunctions = DocumentManager.getInstance().getFunctionRefferences(oldUri);
        if (refferencedFunctions) {
            // 获取自身更新后的调用格式
            const newFunctionCall = MinecraftUtils.buildFunctionCallByUri(newUri);
            if (!newFunctionCall) { return; }
            // 更改所有行
            for (const [uri, lineNumbers] of refferencedFunctions) {
                // 获取文档
                const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
                if (!document) {; continue; }
                // 获取要修改的行
                for (const lineNumber of lineNumbers) {
                    // 替换函数名
                    const commands = DocumentManager.getInstance().getCommandSegments(document, lineNumber);
                    if (commands[0] !== 'function') { return; }
                    const line = document.lineAt(lineNumber);
                    const newText = line.text.replace(commands[1], newFunctionCall);
                    // 更新缓存
                    commands[1] = newFunctionCall;
                    // 修改缓存的原key至新key
                    DocumentManager.getInstance().renameDocumentKey(oldUri, newUri);
                    // 替换文本
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(document.uri, line.range, newText);
                    await vscode.workspace.applyEdit(edit);
                }
            }
        }
    }

    private async updateFunctionDispatches(oldUri: vscode.Uri, newUri: vscode.Uri) { 
        if (!oldUri.fsPath.endsWith('.mcfunction')) { return; }
        const dispatchedFunctions = DocumentManager.getInstance().getFunctionDispatchs(oldUri);
        if (dispatchedFunctions) {
            // 获取自身更新后的调用格式
            const newFunctionCall = MinecraftUtils.buildFunctionCallByUri(newUri);
            if (!newFunctionCall) { return; }
            // 获取文档
            const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === oldUri.toString());
            if (!document) { return; }
            // 获取要修改的行
        }
    }

}

