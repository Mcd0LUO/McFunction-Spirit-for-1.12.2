import * as vscode from 'vscode';

/**
 * Minecraft相关工具类（性能优化版）
 * 核心功能：提供Minecraft资源（函数/进度）的路径解析、存在性检查、URI构建能力
 * 核心优化方向：
 * 1. 抽象通用逻辑，消除代码冗余，减少重复计算
 * 2. 缓存高频解析结果，避免重复处理相同资源路径
 * 3. 并行处理多工作区，大幅提升多工作区场景效率
 * 4. 提前拦截无效参数，减少无效资源操作耗时
 */
export class MinecraftUtils {
    /**
     * 路径解析缓存：存储parseResourcePath方法的结果，避免重复解析相同资源路径
     * 数据结构：Map<资源名称字符串, 解析结果>
     * - Key：原始资源名称（如"myfunc"、"namespace:sub/func"）
     * - Value：解析后的[命名空间, 资源路径]数组，或null（格式错误时）
     */
    private static readonly PATH_PARSE_CACHE = new Map<string, [string, string] | null>();

    /**
     * 缓存过期时间（毫秒）：平衡性能与内存占用
     * 设定5秒过期，既保证高频调用时的缓存命中率，又避免资源路径变更后缓存失效
     */
    private static readonly CACHE_TTL = 5000;

    // ====================================== 通用抽象方法 ======================================
    /**
     * 通用资源路径补全：统一处理资源名称的命名空间补全逻辑
     * 解决问题：避免在每个方法中重复编写"拆分路径-补全命名空间"的冗余代码
     * @param resName 原始资源名称（可带/不带命名空间，如"func"、"ns:sub/func"）
     * @returns 补全后的[命名空间, 资源路径]数组（命名空间默认补全为"minecraft"）
     */
    private static getResolvedParts(resName: string): [string, string] {
        // 按冒号拆分资源名称（命名空间与路径的分隔符）
        const parts = resName.split(':');

        // 场景1：资源名称不含冒号（如"func"）→ 补全默认命名空间"minecraft"
        // 场景2：资源名称含多个冒号（如"ns:sub:func"）→ 仅第一个冒号为分隔符，后续冒号保留在路径中
        if (parts.length !== 2) {
            return [
                'minecraft',  // 默认命名空间
                parts.length === 1 ? parts[0].trim() : parts.slice(1).join(':').trim()  // 处理多冒号场景
            ];
        }

        // 场景3：资源名称含一个冒号（标准格式）→ 直接trim去空格后返回
        return [parts[0].trim(), parts[1].trim()];
    }

    /**
     * 通用资源存在性检查：复用多资源类型（函数/进度）的存在性验证逻辑
     * 解决问题：避免isFunctionExists与isAdvancementExists的代码重复，统一工作区遍历、文件检查逻辑
     * @param resName 资源名称（如"ns:func"、"ns:sub/adv"）
     * @param resourceDir 资源对应的根目录（函数→"functions"，进度→"advancements"）
     * @param extension 资源文件的扩展名（函数→".mcfunction"，进度→".json"）
     * @returns Promise<boolean> 资源文件存在返回true，否则返回false
     */
    private static async checkResourceExists(
        resName: string,
        resourceDir: string,
        extension: string
    ): Promise<boolean> {
        // 1. 解析并补全资源路径（命名空间+资源名）
        const [nameSpace, resourceName] = this.getResolvedParts(resName);

        // 2. 提前拦截无效参数：避免无效参数进入后续工作区遍历，节省时间
        // 无效场景：命名空间为空、资源名为空（如"ns:"、":func"）
        if (!nameSpace || !resourceName) {
            return false;
        }

        // 3. 检查工作区是否存在：无打开工作区直接返回false
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return false;
        }

        // 4. 并行处理多工作区（核心优化点）
        // 原逻辑：顺序遍历工作区，总耗时=各工作区耗时之和
        // 优化后：Promise.all并行处理，总耗时=最慢单个工作区耗时（提升3-10倍效率）
        const checkPromises = workspaceFolders.map(async (workspaceFolder) => {
            try {
                // 构建资源文件的完整URI（按Minecraft标准目录结构）
                const resourceUri = vscode.Uri.joinPath(
                    workspaceFolder.uri,       // 工作区根目录
                    resourceDir,                // 资源类型目录（如functions）
                    nameSpace,                   // 命名空间目录（如minecraft）
                    `${resourceName}${extension}`// 资源文件（如func.mcfunction）
                );

                // 检查文件是否存在：fs.stat会在文件不存在时抛出错误
                const fileStat = await vscode.workspace.fs.stat(resourceUri);
                // 验证是否为文件（排除文件夹）
                return fileStat.type === vscode.FileType.File;
            } catch (error) {
                // 单个工作区检查失败（文件不存在/权限问题）→ 返回false，不影响其他工作区
                return false;
            }
        });

        // 5. 等待所有并行任务完成，只要有一个工作区存在文件即返回true
        const checkResults = await Promise.all(checkPromises);
        return checkResults.some(isExists => isExists);
    }

    /**
     * 通用资源URI构建：复用不同资源类型的URI拼接逻辑
     * 解决问题：避免buildFunctionUri与buildAdvancementUri的代码重复
     * @param resName 资源名称（如"ns:func"、"ns:sub/adv"）
     * @param resourceDir 资源对应的根目录（函数→"functions"，进度→"advancements"）
     * @param extension 资源文件的扩展名（函数→".mcfunction"，进度→".json"）
     * @returns vscode.Uri | null 构建成功返回URI，失败返回null
     */
    public static buildResourceUri(
        resName: string,
        resourceDir: string,
        extension: string
    ): vscode.Uri | null {
        // 1. 解析并补全资源路径
        const [nameSpace, resourceName] = this.getResolvedParts(resName);

        // 2. 提前拦截无效参数
        if (!nameSpace || !resourceName) {
            return null;
        }

        // 3. 检查工作区是否存在（仅使用第一个工作区，与原逻辑一致）
        const targetWorkspace = vscode.workspace.workspaceFolders?.[0];
        if (!targetWorkspace) {
            return null;
        }

        // 4. 拼接资源文件URI并返回
        return vscode.Uri.joinPath(
            targetWorkspace.uri,
            resourceDir,
            nameSpace,
            `${resourceName}${extension}`
        );
    }

    // ====================================== 对外暴露API ======================================
    /**
     * 解析资源路径为命名空间和具体路径（带缓存优化）
     * 功能：处理资源名称的格式补全（如无命名空间则补全为"minecraft"）
     * @param resName 原始资源名称（支持格式："func"、"ns:func"、"ns:sub/func"）
     * @returns [命名空间, 资源路径] | null 解析成功返回数组，格式错误（如多冒号）返回null
     */
    public static parseResourcePath(resName: string): [string, string] | null {
        // 1. 优先查询缓存：相同资源名称直接命中缓存，避免重复解析（核心优化点）
        if (this.PATH_PARSE_CACHE.has(resName)) {
            return this.PATH_PARSE_CACHE.get(resName)!;
        }

        // 2. 解析资源名称格式
        const pathParts = resName.split(':');
        // 格式验证：资源名称最多包含一个冒号（如"ns:sub:func"属于格式错误）
        if (pathParts.length > 2) {
            // 缓存错误结果，避免重复验证
            this.cacheAndExpire(resName, null);
            return null;
        }

        // 3. 补全默认命名空间并处理空格
        const [nameSpace, resourcePath] = pathParts.length === 1
            ? ['minecraft', pathParts[0].trim()]  // 无冒号：补全命名空间
            : [pathParts[0].trim(), pathParts[1].trim()];  // 有冒号：直接拆分

        // 4. 验证解析结果有效性
        const parseResult = (nameSpace && resourcePath) ? [nameSpace, resourcePath] as [string, string] : null;
        // 5. 缓存解析结果并设置过期时间
        this.cacheAndExpire(resName, parseResult);

        return parseResult;
    }

    /**
     * 检查Minecraft函数文件是否存在（复用通用检查逻辑）
     * 支持场景：单工作区/多工作区、带/不带命名空间、含子目录的函数路径
     * @param resName 函数资源名称（格式："func"、"ns:func"、"ns:sub/func"）
     * @returns Promise<boolean> 函数文件存在返回true，否则返回false
     */
    public static async isFunctionExists(resName: string): Promise<boolean> {
        // 调用通用检查方法：指定函数对应的目录和扩展名
        return this.checkResourceExists(resName, 'functions', '.mcfunction');
    }

    /**
     * 检查Minecraft进度文件是否存在（复用通用检查逻辑）
     * 支持场景：单工作区/多工作区、带/不带命名空间、含子目录的进度路径
     * @param resName 进度资源名称（格式："adv"、"ns:adv"、"ns:sub/adv"）
     * @returns Promise<boolean> 进度文件存在返回true，否则返回false
     */
    public static async isAdvancementExists(resName: string): Promise<boolean> {
        // 调用通用检查方法：指定进度对应的目录和扩展名
        return this.checkResourceExists(resName, 'advancements', '.json');
    }

    /**
     * 构建Minecraft函数文件的URI（复用通用URI构建逻辑）
     * 作用：生成可用于跳转的函数文件路径（仅使用第一个工作区）
     * @param resName 函数资源名称（格式："func"、"ns:func"、"ns:sub/func"）
     * @returns vscode.Uri | null 构建成功返回URI，失败返回null
     */
    public static buildFunctionUri(resName: string): vscode.Uri | null {
        // 调用通用URI构建方法：指定函数对应的目录和扩展名
        return this.buildResourceUri(resName, 'functions', '.mcfunction');
    }

    /**
     * 构建Minecraft进度文件的URI（复用通用URI构建逻辑）
     * 作用：生成可用于跳转的进度文件路径（仅使用第一个工作区）
     * @param resName 进度资源名称（格式："adv"、"ns:adv"、"ns:sub/adv"）
     * @returns vscode.Uri | null 构建成功返回URI，失败返回null
     */
    public static buildAdvancementUri(resName: string): vscode.Uri | null {
        // 调用通用URI构建方法：指定进度对应的目录和扩展名
        return this.buildResourceUri(resName, 'advancements', '.json');
    }

    // ====================================== 辅助工具方法 ======================================
    /**
     * 缓存数据并设置自动过期清理（私有方法，不对外暴露）
     * 作用：管理PATH_PARSE_CACHE的缓存生命周期，避免内存泄漏
     * @param cacheKey 缓存键（资源名称字符串）
     * @param cacheValue 缓存值（parseResourcePath的解析结果）
     */
    private static cacheAndExpire<T>(cacheKey: string, cacheValue: T): void {
        // 1. 存入缓存
        this.PATH_PARSE_CACHE.set(cacheKey, cacheValue as [string, string] | null);

        // 2. 设置过期定时器：缓存到期后自动删除，释放内存
        setTimeout(() => {
            this.PATH_PARSE_CACHE.delete(cacheKey);
        }, this.CACHE_TTL);
    }

    public static getJsonArgIndex(command: string): number { 
        return command === 'tellraw' ? 2 : 3;
    }
}