// src/ErrorHandler.ts
import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';


export class ErrorHandler {
    static async handleError(error: unknown, context?: string) {
        const stackTrace = new Error().stack;
        const callerFunction = stackTrace ? stackTrace.split("\n")[2].trim() : "Unknown Caller";

        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            if (axiosError.response && axiosError.response.status === 401) {
                await vscode.window.showErrorMessage('Authentication failed: Invalid or expired Personal Access Token (PAT). Please update your PAT.');
                const selection = await vscode.window.showErrorMessage(
                    'Authentication failed: Invalid or expired Personal Access Token (PAT). Would you like to update your PAT?',
                    'Update PAT'
                );

                if (selection === 'Update PAT') {
                    vscode.commands.executeCommand('azureDevopsPullRequest.updatePat');
                }
            } else if (axiosError.response && axiosError.response.status === 409) {
                await vscode.window.showErrorMessage(`${error.response?.data?.message || error.message}`);
            } else if (error.message === "read ECONNRESET") {
                await vscode.window.showErrorMessage('Connectivity problem with Azure Devops. Please check your internet connection.');
            } else {
                await vscode.window.showErrorMessage(`Error ${callerFunction}: ${error.response?.data?.message || error.message}`);
            }
        } else {
            await vscode.window.showErrorMessage(`An unknown error occurred ${callerFunction}: ${error}`);

        }

    }
}
