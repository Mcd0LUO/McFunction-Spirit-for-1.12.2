import { MinecraftCommandCompletionProvider } from './CommandCompletionProvider';

export class CommandRegistry {
    private static providers: Map<string, MinecraftCommandCompletionProvider> = new Map();

    // 注册命令提供者
    static register(command: string, provider: MinecraftCommandCompletionProvider) {
        // console.log("注册命令提供者: " + command);
        this.providers.set(command, provider);
    }

    // 获取命令提供者
    static getProvider(command: string): MinecraftCommandCompletionProvider | undefined {
        return this.providers.get(command);
    }

    // 获取所有根命令
    static getRootCommands(): string[] {
        return Array.from(this.providers.keys());
    }
}