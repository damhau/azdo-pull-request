import * as vscode from 'vscode';
import { PullRequestProvider } from './PullRequestProvider';
import { PullRequestService } from './PullRequestService';
import { SecretManager } from './SecretManager';
import { ConfigurationService } from './ConfigurationService';

export async function activate(context: vscode.ExtensionContext) {

    const secretManager = new SecretManager(context);

    const configurationService = new ConfigurationService(secretManager);

    // Check and prompt for configuration only if not already set
    if (!vscode.workspace.getConfiguration('azureDevopsPullRequest').get<string>('azureDevOpsOrgUrl') || !vscode.workspace.getConfiguration('azureDevopsPullRequest').get<string>('azureDevOpsProject')) {
        // Prompt for configuration only if not set
        await configurationService.promptForConfiguration();
    }

    // Load configuration
    const { azureDevOpsOrgUrl, azureDevOpsProject, azureDevOpsApiVersion, userAgent } = configurationService.getConfiguration();

	const pat = await secretManager.getSecret('PAT');

    console.debug(`Azure Devops Pull Request Started`);
    console.debug(`Azure DevOps URL: ${azureDevOpsOrgUrl}`);
    console.debug(`Azure DevOps Project: ${azureDevOpsProject}`);


	const pullRequestService = new PullRequestService(azureDevOpsOrgUrl, azureDevOpsProject, userAgent,azureDevOpsApiVersion, pat! );
	const pullRequestProvider = new PullRequestProvider(azureDevOpsOrgUrl, azureDevOpsProject, userAgent,azureDevOpsApiVersion, pat! );

    vscode.window.registerTreeDataProvider('pullRequestExplorer', pullRequestProvider);

    context.subscriptions.push(
		vscode.commands.registerCommand('azureDevopsPullRequest.listPullRequests', () => {
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.approvePullRequest', (prItem) => {
			pullRequestService.approvePullRequest(prItem);

		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.rejectPullRequest', (prItem) => {
			pullRequestService.rejectPullRequest(prItem);

		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.createPullRequest', () => {
			pullRequestService.openCreatePullRequestForm();
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.refreshPullRequests', () => {
			pullRequestProvider.refresh(); // Calls the refresh method in the data provider
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.abandonPullRequest', (prItem) => {
			pullRequestService.abandonPullRequest(prItem);
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.openPullRequestInBrowser', (prItem) => {
			const prUrl = `${azureDevOpsOrgUrl}/${azureDevOpsProject}/_git/${prItem.repoName}/pullrequest/${prItem.prId}`;
			vscode.env.openExternal(vscode.Uri.parse(prUrl));
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.addCommentToPullRequest', (prItem) => {
			pullRequestService.openCommentWebview(prItem);
		})
    );


}



export function deactivate() {}
