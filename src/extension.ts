import * as vscode from 'vscode';
import { PullRequestProvider } from './PullRequestProvider';
import { PullRequestService } from './PullRequestService';
import { SecretManager } from './SecretManager';
import { ConfigurationService } from './ConfigurationService';
import { ProjectProvider } from './ProjectProvider';
import { ProjectService } from './ProjectService';

export async function activate(context: vscode.ExtensionContext) {

	const secretManager = new SecretManager(context);

	const configurationService = new ConfigurationService(secretManager, context);

	// Check and prompt for configuration only if not already set
	if (!vscode.workspace.getConfiguration('azureDevopsPullRequest').get<string>('azureDevOpsOrgUrl') || !vscode.workspace.getConfiguration('azureDevopsPullRequest').get<string>('azureDevOpsProject')) {
		// Prompt for configuration only if not set
		await configurationService.promptForConfiguration();
	}

	// Load configuration
	const { azureDevOpsOrgUrl, azureDevOpsApiVersion, userAgent } = configurationService.getConfiguration();

	const pat = await secretManager.getSecret('PAT');

	console.debug(`Azure Devops Pull Request Started`);
	console.debug(`Azure DevOps URL: ${azureDevOpsOrgUrl}`);


	const pullRequestService = new PullRequestService(azureDevOpsOrgUrl, userAgent, azureDevOpsApiVersion, pat!);
	const pullRequestProvider = new PullRequestProvider(azureDevOpsOrgUrl, userAgent, azureDevOpsApiVersion, pat!, configurationService);

    const projectService = new ProjectService(azureDevOpsOrgUrl, userAgent, azureDevOpsApiVersion);
    const projectProvider = new ProjectProvider(secretManager, projectService, configurationService);


    // Create the TreeView for the sidebar
	vscode.window.registerTreeDataProvider('pullRequestExplorer', pullRequestProvider);

    vscode.window.createTreeView('pullRequestExplorer', {
        treeDataProvider: pullRequestProvider,
        showCollapseAll: true, // Optional: Shows a "collapse all" button
    });

	vscode.window.registerTreeDataProvider('projectExplorerPR', projectProvider);

    vscode.window.createTreeView('projectExplorerPR', {
        treeDataProvider: projectProvider,
        showCollapseAll: true
    });

	await projectProvider.refresh();

	context.subscriptions.push(
		vscode.commands.registerCommand('azureDevopsPullRequest.configure', () => configurationService.updateConfiguration()),
        vscode.commands.registerCommand('azureDevopsPullRequest.updatePat', () => configurationService.updatePat()),
		vscode.commands.registerCommand('azureDevopsPullRequest.listPullRequests', () => {
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.approvePullRequest', (prItem) => {

			pullRequestService.approvePullRequest(prItem, configurationService.getSelectedProjectFromGlobalState()!);

		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.rejectPullRequest', (prItem) => {
			pullRequestService.rejectPullRequest(prItem, configurationService.getSelectedProjectFromGlobalState()!);

		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.createPullRequest', async (repoItem) => {
			await pullRequestService.openCreatePullRequestForm(configurationService.getSelectedProjectFromGlobalState()!, repoItem.repoId);
			await pullRequestProvider.refresh(); // Refresh only if the pull request was successfully created

		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.createPullRequestNewRepo', async () => {
			await pullRequestService.openCreatePullRequestForm(configurationService.getSelectedProjectFromGlobalState()!);
			await pullRequestProvider.refresh(); // Refresh only if the pull request was successfully created

		}),



		vscode.commands.registerCommand('azureDevopsPullRequest.refreshPullRequests', () => {
			pullRequestProvider.refresh(); // Calls the refresh method in the data provider
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.abandonPullRequest', async (prItem) => {
			await pullRequestService.abandonPullRequest(prItem, configurationService.getSelectedProjectFromGlobalState()!);
			await pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.openPullRequestInBrowser', (prItem) => {
			const prUrl = `${azureDevOpsOrgUrl}/${configurationService.getSelectedProjectFromGlobalState()!}/_git/${prItem.repoName}/pullrequest/${prItem.prId}`;
			vscode.env.openExternal(vscode.Uri.parse(prUrl));
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.addCommentToPullRequest', (prItem) => {
			pullRequestService.openCommentWebview(prItem, configurationService.getSelectedProjectFromGlobalState()!);
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.viewPullRequestDetails', async (prItem) => {
			await pullRequestService.openPullRequestDiffView(prItem, configurationService.getSelectedProjectFromGlobalState()!);
		}),
        vscode.commands.registerCommand('azureDevopsPullRequest.selectProject', async (projectId: string) => {
            await configurationService.updateSelectedProjectInGlobalState(projectId);
            pullRequestProvider.refresh();
        }),
        vscode.commands.registerCommand('azureDevopsPullRequest.selectProjectsToShow', async () => {
            await projectProvider.promptForProjectSelection();
            pullRequestProvider.refresh();
        }),
	);


}



export function deactivate() { }
