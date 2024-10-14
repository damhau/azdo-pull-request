import * as vscode from 'vscode';
import * as os from 'os';

import { SecretManager } from './SecretManager';

export class ConfigurationService {
    private secretManager?: SecretManager;
    private context?: vscode.ExtensionContext;

    constructor(secretManager?: SecretManager, context?: vscode.ExtensionContext) {
        this.secretManager = secretManager;
        this.context = context;
    }

    getConfiguration() {
        const config = vscode.workspace.getConfiguration('azureDevopsPullRequest');
        return {
            azureDevOpsOrgUrl: config.get<string>('azureDevOpsOrgUrl') || '',
            azureDevOpsApiVersion: config.get<string>('azureDevOpsApiVersion') || '7.1',
            azureDevOpsTeam: config.get<string>('azureDevOpsTeam') || 'Cloud Native',
            userAgent: config.get<string>('userAgent') || `azure-devops-pull-request-extension/1.0 (${os.platform()}; ${os.release()})`

        };
    }

    async promptForConfiguration() {
        const config = vscode.workspace.getConfiguration('azureDevopsPullRequest');

        let url = config.get<string>('azureDevOpsOrgUrl');
        let pat = await this.secretManager!.getSecret('PAT');

        if (!url || !pat) {
            const inputUrl = await vscode.window.showInputBox({
                prompt: 'Enter your Azure DevOps organization URL',
                placeHolder: 'https://dev.azure.com/your-organization',
                ignoreFocusOut: true
            });

            const inputPat = await vscode.window.showInputBox({
                prompt: 'Enter your Azure DevOps Personal Access Token',
                placeHolder: 'Enter PAT',
                password: true,
                ignoreFocusOut: true
            });


            if (inputUrl && inputPat) {
                await vscode.workspace.getConfiguration('azureDevopsPullRequest').update('azureDevOpsOrgUrl', inputUrl, vscode.ConfigurationTarget.Global);
                await this.secretManager!.storeSecret('PAT', inputPat);
                await this.clearSelectedProjectState();
                await this.clearFilteredProjectsState();
                vscode.window.showInformationMessage('Configuration saved successfully.');
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            } else {
                vscode.window.showErrorMessage('Failed to get configuration.');
            }
        }
    }




    async updateConfiguration() {
        const config = vscode.workspace.getConfiguration('azureDevopsPullRequest');
        let url = config.get<string>('azureDevOpsOrgUrl');

        const inputUrl = await vscode.window.showInputBox({
            prompt: 'Enter your Azure DevOps organization URL',
            placeHolder: 'https://dev.azure.com/your-organization',
            value: url,
            ignoreFocusOut: true
        });

        const inputPat = await vscode.window.showInputBox({
            prompt: 'Enter your Azure DevOps Personal Access Token',
            placeHolder: 'Enter PAT',
            password: true,
            ignoreFocusOut: true
        });


        if (inputUrl  && inputPat) {
            await vscode.workspace.getConfiguration('azureDevopsPullRequest').update('azureDevOpsOrgUrl', inputUrl, vscode.ConfigurationTarget.Global);
            await this.secretManager!.storeSecret('PAT', inputPat);
            await this.clearSelectedProjectState();
            await this.clearFilteredProjectsState();
            vscode.window.showInformationMessage('Configuration saved successfully.');
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        } else {
            vscode.window.showErrorMessage('Failed to get configuration.');
        }
    }

    async updatePat() {
        const inputPat = await vscode.window.showInputBox({
            prompt: 'Enter your Azure DevOps Personal Access Token',
            placeHolder: 'Enter PAT',
            password: true,
            ignoreFocusOut: true
        });

        if (inputPat) {
            await this.secretManager!.storeSecret('PAT', inputPat);
            vscode.window.showInformationMessage('Configuration saved successfully.');
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        } else {
            vscode.window.showErrorMessage('Failed to get configuration.');
        }
    }

    async updateSelectedProjectInGlobalState(projectId: string) {
        await this.context?.globalState.update('azureDevOpsSelectedProjectPR', projectId);
    }

    getSelectedProjectFromGlobalState(): string | undefined {
        const selectedProject = this.context?.globalState.get<string>('azureDevOpsSelectedProjectPR');
        return selectedProject;
    }

    async clearSelectedProjectState(): Promise<void> {
        await this.context?.globalState.update('azureDevOpsSelectedProjectPR', undefined);
    }

    async updateFilteredprojectInGlobalState(projectIds: string[]) {
        await this.context?.globalState.update('azureDevOpsFilteredProjectsPR', projectIds);
    }

    getFilteredProjectsFromGlobalState(): string[] | undefined {
        return this.context?.globalState.get<string[]>('azureDevOpsFilteredProjectsPR');
    }

    async clearFilteredProjectsState(): Promise<void> {
        await this.context?.globalState.update('azureDevOpsFilteredProjectsPR', undefined);
    }
}
