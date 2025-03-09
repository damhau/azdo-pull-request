import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR"
}

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private currentLogLevel: LogLevel;

    private constructor(extensionName: string) {
        this.outputChannel = vscode.window.createOutputChannel(`${extensionName} Logs`);
        this.currentLogLevel = LogLevel.DEBUG; // Default log level
    }

    public static getInstance(context: vscode.ExtensionContext): Logger {
        if (!Logger.instance) {
            const extensionName = "Azure Devops Review Pull Request";
            Logger.instance = new Logger(extensionName);
        }
        return Logger.instance;
    }

    public setLogLevel(level: LogLevel) {
        this.currentLogLevel = level;
    }

    public log(message: string, level: LogLevel = LogLevel.INFO) {
        if (this.shouldLog(level)) {
            const timestamp = new Date().toISOString();
            this.outputChannel.appendLine(`[${timestamp}] ${message}`);
        }
    }

    public debug(message: string) {
        this.log(`🔵 ${message}`, LogLevel.DEBUG);
    }

    public info(message: string) {
        this.log(`ℹ️ ${message}`, LogLevel.INFO);
    }

    public warn(message: string) {
        this.log(`⚠️ ${message}`, LogLevel.WARN);
    }

    public error(message: string) {
        this.log(`❌ ${message}`, LogLevel.ERROR);
    }

    public show() {
        this.outputChannel.show();
    }

    public dispose() {
        this.outputChannel.dispose();
    }

    private shouldLog(level: LogLevel): boolean {
        const levelOrder = {
            [LogLevel.DEBUG]: 0,
            [LogLevel.INFO]: 1,
            [LogLevel.WARN]: 2,
            [LogLevel.ERROR]: 3
        };

        return levelOrder[level] >= levelOrder[this.currentLogLevel];
    }
}
