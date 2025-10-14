import { TextDocument, Position, CompletionItem, DocumentDropEdit } from "vscode";
import { MinecraftCommandCompletionProvider } from "../core/CommandCompletionProvider";


export class TestCompletionProvider extends MinecraftCommandCompletionProvider {
    public provideCommandCompletions(commands: string[], lineCommands: string[], document: TextDocument, position: Position): CompletionItem[] {
        return [];
    }


}