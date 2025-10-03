import * as vscode from 'vscode';
import { PullRequestProvider } from './PullRequestProvider';
import { PullRequestService } from './PullRequestService';
import { SecretManager } from './SecretManager';
import { ConfigurationService } from './ConfigurationService';
import { ProjectProvider } from './ProjectProvider';
import { ProjectService } from './ProjectService';
import { extensions, Extension } from 'vscode';
import { Logger, LogLevel } from './LoggingService';





interface GitExtension {
	getAPI(version: number): BuiltInGitApi;
}

interface BuiltInGitApi {
	repositories: any[];
}


export async function activate(context: vscode.ExtensionContext) {


	const logger = Logger.getInstance(context);
	logger.setLogLevel(LogLevel.INFO); // Set desired log level

	const secretManager = new SecretManager(context);

	const configurationService = new ConfigurationService(secretManager, context);

	// Check and prompt for configuration only if not already set
	if (!vscode.workspace.getConfiguration('azureDevopsPullRequest').get<string>('azureDevOpsOrgUrl') || !vscode.workspace.getConfiguration('azureDevopsPullRequest').get<string>('azureDevOpsProject')) {
		// Prompt for configuration only if not set
		await configurationService.promptForConfiguration();
	}

	// Load configuration
	const { azureDevOpsOrgUrl, azureDevOpsApiVersion, userAgent, azureDevOpsTeam } = configurationService.getConfiguration();

	const pat = await secretManager.getSecret('PAT');

	logger.info(`Azure Devops Pull Request Started`);
	logger.info(`Azure DevOps URL: ${azureDevOpsOrgUrl}`);


	const pullRequestService = new PullRequestService(azureDevOpsOrgUrl, userAgent, azureDevOpsApiVersion, pat!);
	const pullRequestProvider = new PullRequestProvider(configurationService, pullRequestService);

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


	const gitApi = await getBuiltInGitApi();

	if (!gitApi) {
		vscode.window.showErrorMessage("Git API is unavailable. Git-based features will be disabled.");
	} else {
		if (!gitApi.repositories.length) {
			vscode.window.showErrorMessage("No Git repository found in this workspace. Git-based features will be disabled until a repository is detected.");
		}

		// Start monitoring Git commits when repositories are available
		pullRequestService.monitorGitCommits(gitApi, configurationService);
	}


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
			const azureDevOpsTeamId = await pullRequestService.getTeamIdFromName(configurationService.getSelectedProjectFromGlobalState()!, azureDevOpsTeam);
			await pullRequestService.openCreatePullRequestForm(configurationService.getSelectedProjectFromGlobalState()!, azureDevOpsTeamId!, repoItem.repoId);
			pullRequestProvider.refresh(); // Refresh only if the pull request was successfully created

		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.createPullRequestNewRepo', async () => {
			const azureDevOpsTeamId = await pullRequestService.getTeamIdFromName(configurationService.getSelectedProjectFromGlobalState()!, azureDevOpsTeam);
			await pullRequestService.openCreatePullRequestForm(configurationService.getSelectedProjectFromGlobalState()!, azureDevOpsTeamId!);
			pullRequestProvider.refresh(); // Refresh only if the pull request was successfully created

		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.createPullRequestForCurrentBranch', async () => {
			const gitApiForCommand = await getBuiltInGitApi();
			if (!gitApiForCommand) {
				vscode.window.showErrorMessage('Git API is unavailable.');
				return;
			}

			const created = await pullRequestService.createPullRequestForCurrentBranch(gitApiForCommand, configurationService);
			if (created) {
				pullRequestProvider.refresh();
			}
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.openFileContent', (fileName: string, fileUrl: string, originalObjectId: string, repoName: string, changeType: string) => {
			if (changeType === 'edit') {
				pullRequestService.openFileDiffInNativeDiffEditor(fileName, configurationService.getSelectedProjectFromGlobalState()!, repoName, originalObjectId, fileUrl);
			} else if (changeType === 'add') {
				pullRequestService.openFileInNativeDiffEditor(fileName, fileUrl);
			}
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.addCommentToFile', (fileItem) => {
			pullRequestService.addCommentToFile(fileItem.filePath, fileItem.repoName, fileItem.pullRequestId, configurationService.getSelectedProjectFromGlobalState()!);
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.refreshPullRequests', () => {
			pullRequestProvider.refresh(); // Calls the refresh method in the data provider
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.abandonPullRequest', async (prItem) => {
			await pullRequestService.abandonPullRequest(prItem, configurationService.getSelectedProjectFromGlobalState()!);
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.openPullRequestInBrowser', (prItem) => {
			const prUrl = `${azureDevOpsOrgUrl}/${configurationService.getSelectedProjectFromGlobalState()!}/_git/${prItem.repoName}/pullrequest/${prItem.prId}`;
			vscode.env.openExternal(vscode.Uri.parse(prUrl));
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.addCommentToPullRequest', (prItem) => {
			pullRequestService.openCommentWebview(prItem, configurationService.getSelectedProjectFromGlobalState()!);
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.selectProject', async (projectId: string) => {
			await configurationService.updateSelectedProjectInGlobalState(projectId);
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.selectProjectsToShow', async () => {
			await projectProvider.promptForProjectSelection();
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand('azureDevopsPullRequest.copyPullRequestUrl', async (prItem) => {
			const azureDevOpsOrgUrl = configurationService.getConfiguration().azureDevOpsOrgUrl;
			const project = configurationService.getSelectedProjectFromGlobalState();

			if (!azureDevOpsOrgUrl || !project) {
				vscode.window.showErrorMessage('Failed to copy the pull request URL: Missing configuration.');
				return;
			}

			const prUrl = `${azureDevOpsOrgUrl}/${project}/_git/${prItem.repoName}/pullrequest/${prItem.prId}`;
			await vscode.env.clipboard.writeText(prUrl);


		})
	);


}


export function deactivate() {
	Logger.getInstance({} as vscode.ExtensionContext).dispose();
}

async function getBuiltInGitApi(): Promise<BuiltInGitApi | undefined> {
	try {
		const extension = extensions.getExtension('vscode.git') as Extension<GitExtension>;

		if (!extension) {
			vscode.window.showErrorMessage("Git extension 'vscode.git' not found.");
			return undefined;
		}

		if (!extension.isActive) {
			console.debug("[DEBUG] Activating Git extension...");
			await extension.activate();
		}

		const gitApi = extension.exports.getAPI(1);
		if (!gitApi.repositories.length) {
			console.debug("[DEBUG] No Git repository found. Waiting...");
			await waitForRepository(gitApi);
		}

		return gitApi;
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to activate Git API: ${error}`);
	}

	return undefined;
}

// Helper function to wait for a repository to be available
async function waitForRepository(gitApi: BuiltInGitApi): Promise<void> {
	return new Promise((resolve) => {
		const interval = setInterval(() => {
			if (gitApi.repositories.length > 0) {
				console.debug("[DEBUG] Git repository detected:", gitApi.repositories[0].rootUri.fsPath);
				clearInterval(interval);
				resolve();
			}
		}, 1000);
	});
}