import axios, { AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import * as vscode from 'vscode';
import { ErrorHandler } from './ErrorHandler';

// Enable retry for axios requests
axiosRetry(axios, { retries: 3 });

export class ProjectService {
    private azureDevOpsOrgUrl: string;
    private userAgent: string;
    private azureDevOpsApiVersion: string;

    constructor(orgUrl: string, userAgent: string, apiVersion: string) {
        this.azureDevOpsOrgUrl = orgUrl;
        this.userAgent = userAgent;
        this.azureDevOpsApiVersion = apiVersion;
    }

    // Fetch the list of projects from Azure DevOps
    async listProjects(personalAccessToken: string): Promise<any[]> {
        const url = `${this.azureDevOpsOrgUrl}/_apis/projects?api-version=${this.azureDevOpsApiVersion}`;

        try {

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + personalAccessToken).toString('base64')}`
                }
            });
            return response.data.value;
        } catch (error: unknown) {
            this.handleError(error);
            return [];
        }
    }

    // Error handler for Axios requests
    // private async handleError(error: unknown) {
    //     const stackTrace = new Error().stack;
    //     const callerFunction = stackTrace ? stackTrace.split("\n")[2].trim() : "Unknown Caller";

    //     if (axios.isAxiosError(error)) {
    //         const axiosError = error as AxiosError;
    //         if (axiosError.response && axiosError.response.status === 401) {
    //             await vscode.window.showErrorMessage('Authentication failed: Invalid or expired Personal Access Token (PAT). Please update your PAT.');
    //             const selection = await vscode.window.showErrorMessage(
    //                 'Authentication failed: Invalid or expired Personal Access Token (PAT). Would you like to update your PAT?',
    //                 'Update PAT'
    //             );

    //             if (selection === 'Update PAT') {
    //                 // Trigger the update PAT command
    //                 vscode.commands.executeCommand('azureDevopsPullRequest.updatePat');
    //             }


    //         } else if (axiosError.response && axiosError.response.status === 409) {

    //             await vscode.window.showErrorMessage(`${error.response?.data?.message || error.message}`);
    //         } else if (error.message === "read ECONNRESET") {
    //             await vscode.window.showErrorMessage('Connectivity problem with Azure Devops. Please check your internet connection.');


    //         }

    //         else {
    //             await vscode.window.showErrorMessage(`Error ${callerFunction}: ${error.response?.data?.message || error.message}`);
    //         }
    //     } else {
    //         await vscode.window.showErrorMessage(`An unknown error occurred: ${error}`);
    //     }
    // }
    private async handleError(error: unknown) {
        await ErrorHandler.handleError(error, 'PullRequestService');
        return [];
    }
}
