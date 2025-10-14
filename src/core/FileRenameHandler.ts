import * as vscode from 'vscode';
import * as fs from 'fs';

export class FileRenameHandler {
    // private resourceManager: ResourceManager;

    // constructor(resourceManager: ResourceManager) {
    //     this.resourceManager = resourceManager;
    // }

    /** 初始化文件重命名事件监听 */
    init() {
        // 监听VS Code的文件重命名事件
        vscode.workspace.onDidRenameFiles(async (event) => {
            for (const file of event.files) {
                await this.handleRename(file.oldUri, file.newUri);
            }
        });
    }

    /** 处理单个文件/文件夹重命名 */
    private async handleRename(oldUri: vscode.Uri, newUri: vscode.Uri) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(oldUri);
        if (!workspaceFolder) {return;}

        // 1. 解析旧路径和新路径（相对于工作区根目录）

        // 2. 判断是文件还是文件夹
        const stat = await fs.statSync(oldUri.fsPath);
        const isFile = stat.isFile() ? false : true;
        if (isFile) {
            // 文件重命名逻辑
            const oldPath = oldUri.fsPath;
            const newPath = newUri.fsPath;

            // 获取文件名（不包含扩展名）
            const oldFileName = oldPath.split('/').pop() || oldPath;
            const newFileName = newPath.split('/').pop() || newPath;

            // 获取文件扩展名
            const oldFileExtension = oldFileName.split('.').pop() || '';

        }



    }

    /** 批量更新引用路径 */
    private async updateReferences(
        references: Array<{ uri: vscode.Uri; range: vscode.Range; text: string }>,
        oldPath: string,
        newPath: string,
        isDirectory: boolean
    ) {
        for (const ref of references) {
            // 读取文件内容
            const document = await vscode.workspace.openTextDocument(ref.uri);
            const text = document.getText();

            // 替换引用路径（根据是否为文件夹调整替换规则）
            const newText = isDirectory
                ? this.replaceDirectoryReferences(text, oldPath, newPath)
                : this.replaceFileReferences(text, oldPath, newPath);

            // 写入更新后的内容
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                ref.uri,
                new vscode.Range(0, 0, document.lineCount - 1, Infinity),
                newText
            );
            await vscode.workspace.applyEdit(edit);
        }
    }

    /** 替换文件夹路径引用（例如：从 old/func 改为 new/func） */
    private replaceDirectoryReferences(content: string, oldDir: string, newDir: string): string {
        // 正则匹配引用路径（需根据Minecraft函数引用格式调整）
        const regex = new RegExp(`("|')${escapeRegExp(oldDir)}/([^'"]+)('|")`, 'g');
        return content.replace(regex, `$1${newDir}/$2$3`);
    }

    /** 替换文件路径引用（例如：从 old.mcfunction 改为 new.mcfunction） */
    private replaceFileReferences(content: string, oldFile: string, newFile: string): string {
        const oldFileName = oldFile.split('/').pop() || oldFile;
        const newFileName = newFile.split('/').pop() || newFile;
        // 匹配文件名引用（含不带扩展名的情况）
        const regex = new RegExp(`("|')${escapeRegExp(oldFileName.replace('.mcfunction', ''))}('|")`, 'g');
        return content.replace(regex, `$1${newFileName.replace('.mcfunction', '')}$2`);
    }
}

// 辅助函数：转义正则特殊字符
function escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
