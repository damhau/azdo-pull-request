import axios, { AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import * as vscode from 'vscode';
import { Logger, LogLevel } from './LoggingService';
import { ErrorHandler } from './ErrorHandler';

const logger = Logger.getInstance({} as vscode.ExtensionContext);
logger.setLogLevel(LogLevel.DEBUG); // Set desired log level

axiosRetry(axios, {
    retries: 3, // Number of retries (Defaults to 3)
});


// Implementing TextDocumentContentProvider to serve virtual content
class DiffContentProvider implements vscode.TextDocumentContentProvider {
    private contents = new Map<string, string>();

    // Set the content for a specific URI
    setContent(uri: vscode.Uri, content: string) {
        this.contents.set(uri.toString(), content);
    }

    // Provide content when VS Code tries to resolve the content of a URI
    provideTextDocumentContent(uri: vscode.Uri): string | undefined {
        return this.contents.get(uri.toString());
    }
}

export class PullRequestService {
    private contentProvider: DiffContentProvider;
    private azureDevOpsOrgUrl: string;
    private userAgent: string;
    private azureDevOpsApiVersion: string;
    private azureDevOpsPat: string;

    private repository: any;



    constructor(orgUrl: string, userAgent: string, apiVersion: string, pat: string) {
        this.azureDevOpsOrgUrl = orgUrl;
        this.userAgent = userAgent;
        this.azureDevOpsApiVersion = apiVersion;
        this.azureDevOpsPat = pat;
        this.contentProvider = new DiffContentProvider();
        vscode.workspace.registerTextDocumentContentProvider('diff', this.contentProvider);

    }

    //#region Pull request functions

    async abandonPullRequest(prItem: any, azureDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;
        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullrequests/${pullRequestId}?api-version=${this.azureDevOpsApiVersion}`;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to abandon this pull request?`,
            { modal: true },
            'Yes', 'No'
        );

        if (confirm !== 'Yes') {
            return;
        }

        try {

            await axios.patch(
                url,
                { status: 'abandoned' },
                {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                    }
                }
            );

            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Pull Request Abandoned: ${pullRequestId}`,
                    cancellable: false,
                },
                async (progress, token) => {
                    for (let i = 0; i < 2; i++) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        setTimeout(() => {
                            progress.report({ increment: i * 10, message: '' });
                        }, 10000);
                    }
                }
            );


        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async openCreatePullRequestForm(azureDevOpsProject: string, azureDevOpsTeam: string, repositoryId?: string, branchName?: string): Promise<boolean> {
        if (repositoryId === undefined) {
            this.repository = await vscode.window.showQuickPick(this.getSortedRepositories(azureDevOpsProject), {
                placeHolder: 'Select the repository for the pull request'
            });

            if (!this.repository) {
                vscode.window.showErrorMessage('Repository is required to create a pull request.');
                return false;
            }


        } else {

            this.repository = repositoryId;
        }
        let sourceBranch: any;
        if (branchName === undefined) {
            sourceBranch = await vscode.window.showQuickPick(this.getBranches(this.repository, azureDevOpsProject), {
                placeHolder: 'Select the source branch for the pull request'
            });
        }
        else {
            sourceBranch = branchName;
        }

        if (!sourceBranch) {
            vscode.window.showErrorMessage('Source branch is required to create a pull request.');
            return false;
        }

        const targetBranch = await this.getDefaultBranch(this.repository, azureDevOpsProject); // Fetch the default branch dynamically
        if (!targetBranch) {
            vscode.window.showErrorMessage('Could not find the default branch for the repository.');
            return false;
        }



        const title = await vscode.window.showInputBox({
            prompt: 'Enter the title for the pull request'
        });

        if (!title) {
            vscode.window.showErrorMessage('Title is required to create a pull request.');
            return false;
        }

        const description = await vscode.window.showInputBox({
            prompt: 'Enter the description for the pull request (optional)'
        });

        let pbiDetails: any[] = [];

        if (azureDevOpsTeam === null) {
            pbiDetails.unshift({
                id: "",
                fields: { 'System.Title': 'None' },
                _links: { html: { href: '' } }

            });

        } else {

            pbiDetails = await this.getPBIDetails(azureDevOpsProject, azureDevOpsTeam);
            pbiDetails.unshift({
                id: "",
                fields: { 'System.Title': 'None' },
                _links: { html: { href: '' } }

            });
        }

        const selectedPBI = await vscode.window.showQuickPick(
            pbiDetails.map(pbi => ({
                label: pbi.id.toString(),
                description: pbi.fields['System.Title'],
                url: pbi._links.html.href
            })),
            {
                placeHolder: 'Select a PBI to attach to the PR (optional)',
                canPickMany: false
            }
        );

        const configureAutoComplete = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Do you want to enable auto complete on the pull request?'
        });

        let autoComplete: boolean;
        if (configureAutoComplete === "Yes") {
            autoComplete = true;
        } else {
            autoComplete = false;
        }
        if (selectedPBI) {
            const pbiId = selectedPBI.label;
            const pbiUrl = selectedPBI.url;
            await this.createPullRequest(this.repository, sourceBranch, targetBranch, title, description || '', azureDevOpsProject, autoComplete, pbiId, pbiUrl);
            return true;
            // Store the PBI ID for linking later
        } else {
            await this.createPullRequest(this.repository, sourceBranch, targetBranch, title, description || '', azureDevOpsProject, autoComplete);
            return true;
        }

    }

    async createPullRequest(repository: string, sourceBranch: string, targetBranch: string, title: string, description: string, azureDevOpsProject: string, enableAutoComplete: boolean, pbiId?: string, pbiUrl?: string) {
        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repository}/pullrequests?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.post(
                url,
                {
                    sourceRefName: `refs/heads/${sourceBranch}`,
                    targetRefName: `refs/heads/${targetBranch}`,
                    title: title,
                    description: description,
                    workItemRefs: [{
                        id: pbiId, // ID of the work item to link
                        url: pbiUrl
                    }],
                },
                {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                    }
                }
            );

            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Pull Request Created: ${response.data.pullRequestId}`,
                    cancellable: false,
                },
                async (progress, token) => {
                    for (let i = 0; i < 2; i++) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        setTimeout(() => {
                            progress.report({ increment: i * 10, message: '' });
                        }, 10000);
                    }
                }
            );
            if (enableAutoComplete) {

                const autoCompleteSetBy = await this.getLoggedInUserId();

                await this.enableAutoComplete(response.data.pullRequestId, repository, azureDevOpsProject, autoCompleteSetBy);

                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Enabling Auto Complete: ${response.data.pullRequestId}`,
                        cancellable: false,
                    },
                    async (progress, token) => {
                        for (let i = 0; i < 2; i++) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            setTimeout(() => {
                                progress.report({ increment: i * 10, message: '' });
                            }, 10000);
                        }
                    }
                );

            }

            const prItem = { "repoName": repository, "prId": response.data.pullRequestId };
            await vscode.commands.executeCommand("azureDevopsPullRequest.copyPullRequestUrl", prItem);

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async enableAutoComplete(pullRequestId: number, repositoryId: string, azureDevOpsProject: string, autoCompleteSetBy: string) {
        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}?api-version=${this.azureDevOpsApiVersion}`;

        const payload = {
            "completionOptions": {
                "autoCompleteIgnoreConfigIds": [],
                "bypassPolicy": false,
                "deleteSourceBranch": true,
                "mergeStrategy": 1,
                "transitionWorkItems": false,
            },
            "autoCompleteSetBy": {
                "id": autoCompleteSetBy // "c2a1adea-d7bc-4365-a58d-db431cecfcdc" // User ID that sets the auto-complete
            }
        };

        try {
            await axios.patch(url, payload, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async approvePullRequest(prItem: any, azureDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Approving Pull Request",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: `Submitting: ${pullRequestId}` });
                await new Promise(resolve => setTimeout(resolve, 2000));


                const reviewerResponse = await axios.get(
                    `${this.azureDevOpsOrgUrl}/_apis/connectionData`,
                    {
                        headers: {
                            'User-Agent': this.userAgent,
                            'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                        }
                    }
                );

                const reviewerId = reviewerResponse.data.authenticatedUser.id; // Use your user ID as reviewerId
                const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/reviewers/${reviewerId}?api-version=${this.azureDevOpsApiVersion}`;

                await axios.put(
                    url,
                    { vote: 10 }, // Set the vote to 10 (approve)
                    {
                        headers: {
                            'User-Agent': this.userAgent,
                            'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                        }
                    }
                );

                progress.report({ message: `Done: ${pullRequestId}` });
                await new Promise(resolve => setTimeout(resolve, 2000));


            });

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async rejectPullRequest(prItem: any, azureDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Rejecting Pull Request",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: `Submitting: ${pullRequestId}` });
                await new Promise(resolve => setTimeout(resolve, 2000));

                const reviewerResponse = await axios.get(
                    `${this.azureDevOpsOrgUrl}/_apis/connectionData`,
                    {
                        headers: {
                            'User-Agent': this.userAgent,
                            'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                        }
                    }
                );

                const reviewerId = reviewerResponse.data.authenticatedUser.id; // Use your user ID as reviewerId
                const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/reviewers/${reviewerId}?api-version=${this.azureDevOpsApiVersion}`;

                await axios.put(
                    url,
                    { vote: -10 }, // Set the vote to -10 (reject)
                    {
                        headers: {
                            'User-Agent': this.userAgent,
                            'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                        }
                    }
                );

                progress.report({ message: `Done: ${pullRequestId}` });
                await new Promise(resolve => setTimeout(resolve, 2000));

            });

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async addCommentToPullRequest(prItem: any, comment: string, azureDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Adding Comment to Pull Request",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: `Adding comment to PR #${pullRequestId}` });

                const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads?api-version=${this.azureDevOpsApiVersion}`;

                const commentThread = {
                    comments: [
                        {
                            parentCommentId: 0, // Set to 0 for a new comment thread
                            content: comment,
                            commentType: 1 // 1 for a regular comment, 2 for code-related
                        }
                    ],
                    status: 1 // 1 for active, 2 for resolved, etc.
                };

                // Send the request to add the comment
                const response = await axios.post(url, commentThread, {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                    }
                });

                await new Promise(resolve => setTimeout(resolve, 2000));
                progress.report({ message: `Comment added successfully to PR #${pullRequestId}` });

            });

        } catch (error: unknown) {

            return this.handleError(error);
        }
    }

    async getPullRequestCommits(azureDevOpsProject: string, repoName: string, pullRequestId: number): Promise<any[]> {

        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/commits?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });

            return response.data.value || [];
        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async getPullRequests(azureDevOpsProject: string, repoName: string): Promise<any[]> {

        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullrequests?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`


                }
            });

            return response.data.value || [];
        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    //#endregion

    //#region Repository functions
    async getSortedRepositories(azureDevOpsProject: string): Promise<string[]> {
        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(
                url,
                {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                    }
                }
            );

            // return response.data.value.map((repo: any) => repo.name); // Return repository IDs
            return response.data.value
                .map((repo: any) => repo.name) // Extract the repository names
                .sort((a: string, b: string) => a.localeCompare(b)); // Sort alphabetically

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async getRepositories(azureDevOpsProject: string): Promise<any[]> {
        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(
                url,
                {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                    }
                }
            );

            // return response.data.value.map((repo: any) => repo.name); // Return repository IDs
            return response.data.value;


        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async getBranches(repositoryId: string, azureDevOpsProject: string): Promise<string[]> {
        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repositoryId}/refs?filter=heads/&api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(
                url,
                {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                    }
                }
            );
            return response.data.value.map((ref: any) => ref.name.replace('refs/heads/', ''));

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async getDefaultBranch(repositoryId: string, azureDevOpsProject: string): Promise<string | null> {
        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repositoryId}?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });

            // The default branch is returned as "defaultBranch"
            const defaultBranch = response.data.defaultBranch;

            if (defaultBranch) {
                return defaultBranch.replace('refs/heads/', ''); // Remove the 'refs/heads/' prefix
            } else {
                vscode.window.showWarningMessage('Default branch not found.');
                return null;
            }
        } catch (error: unknown) {
            await this.handleError(error);
            return null;
        }
    }

    async getCommitChanges(project: string, repoName: string, commitId: string): Promise<any[]> {
        const url = `${this.azureDevOpsOrgUrl}/${project}/_apis/git/repositories/${repoName}/commits/${commitId}/changes?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });

            return response.data.changes || [];
        } catch (error) {
            return this.handleError(error);
        }
    }
    //#endregion

    //#region File functions
    async addCommentToFile(filePath: string, repoName: string, pullRequestId: string, project: string) {
        // Display WebView to add the comment
        const panel = vscode.window.createWebviewPanel(
            'addCommentToFile',
            `Add Comment to ${filePath}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true
            }
        );

        // Set the WebView content for adding the comment
        panel.webview.html = await this.getAddCommentWebviewContent(filePath);

        // Handle comment submission
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'submit') {
                const comment = message.text;
                if (comment) {
                    // Logic to add the comment to the file in Azure DevOps
                    await this.submitCommentToFile(filePath, repoName, pullRequestId, comment, project);
                    const prItem = { "repoName": repoName, "prId": pullRequestId };
                    await this.openCommentWebview(prItem, project);


                } else {
                    vscode.window.showErrorMessage('Comment cannot be empty.');
                }
            }
        });
    }
    async openFileDiffInNativeDiffEditor(fileName: string, project: string, repositoryId: string, originalObjectId: string, fileUrl: string): Promise<void> {
        try {

            const originalFileContent = await this.fetchOriginalFileContent(project, repositoryId, originalObjectId);
            // Step 2: Fetch the new file content from the URL
            const newFileContent = await this.fetchFileContent(fileUrl);

            // Step 3: Create URIs for the original and modified content using the "diff" scheme
            const originalUri = vscode.Uri.parse(`diff:/${fileName}?original`);
            const modifiedUri = vscode.Uri.parse(`diff:/${fileName}?modified`);

            // Step 4: Set the content for the URIs in the content provider
            this.contentProvider.setContent(originalUri, originalFileContent);
            this.contentProvider.setContent(modifiedUri, newFileContent);

            // Step 5: Use the native vscode.diff command to open the diff editor
            await vscode.commands.executeCommand(
                'vscode.diff',
                originalUri, // URI for the original content
                modifiedUri, // URI for the modified content
                `Diff: ${fileName}` // Title of the diff editor
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file diff: ${error}`);
        }
    }

    async openFileInNativeDiffEditor(fileName: string, fileUrl: string): Promise<void> {
        try {
            // Fetch the file content (for added files, this is the only content)
            const fileContent = await this.fetchFileContent(fileUrl);

            // Create a URI with a custom scheme to represent the in-memory file
            const fileUri = vscode.Uri.parse(`diff:/${fileName}`);

            // Set the content in the content provider
            this.contentProvider.setContent(fileUri, fileContent);

            // Open the file using vscode.workspace.openTextDocument and show it in the editor
            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
    }

    async fetchFileContent(fileUrl: string): Promise<any> {
        const response = await axios.get(fileUrl, {
            headers: {
                'User-Agent': this.userAgent,
                'Accept': 'text/plain',
                'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
            }
        });

        return response.data || 'No content available';
    }

    async fetchOriginalFileContent(project: string, repositoryId: string, originalObjectId: string): Promise<string> {
        const url = `${this.azureDevOpsOrgUrl}/${project}/_apis/git/repositories/${repositoryId}/blobs/${originalObjectId}?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`,
                    'Accept': 'text/plain', // To fetch file content as plain text
                },
            });
            return response.data || 'No original content available';
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fetch original file content: ${error}`);
            return 'Error fetching original file content';
        }
    }
    //#endregion

    //#region Comment functions

    async replyToComment(prItem: any, threadId: number, replyText: string, azureDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads/${threadId}/comments?api-version=${this.azureDevOpsApiVersion}`;

        const payload = {
            content: replyText,
            parentCommentId: 1, // Specify the parent comment ID to reply
            commentType: 1 // 1 for a regular comment
        };

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`,
                    'Content-Type': 'application/json'
                }
            });

        } catch (error: unknown) {
            await this.handleError(error);
        }
    }

    async resolveComment(prItem: any, threadId: number, azureDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads/${threadId}?api-version=${this.azureDevOpsApiVersion}`;
        const payload = {
            status: 2 // Set the status to 2 for "resolved"
        };
        try {
            const response = await axios.patch(url, payload, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`,
                    'Content-Type': 'application/json'
                }
            });

        } catch (error: unknown) {
            await this.handleError(error);
        }
    }

    async reactivateComment(prItem: any, threadId: number, azureDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads/${threadId}?api-version=${this.azureDevOpsApiVersion}`;

        const payload = {
            status: 1 // Set the status to 2 for "resolved"
        };

        try {
            const response = await axios.patch(url, payload, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`,
                    'Content-Type': 'application/json'
                }
            });


        } catch (error: unknown) {
            await this.handleError(error);
        }

    }

    async submitCommentToFile(filePath: string, repoName: string, pullRequestId: string, comment: string, azureDevOpsProject: string) {
        // Implement logic to add a comment to Azure DevOps for the specified file and commit
        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads?api-version=${this.azureDevOpsApiVersion}`;
        const commentThread = {
            comments: [
                {
                    parentCommentId: 0,
                    content: comment,
                    commentType: 2 // 1 for a regular comment
                }
            ],
            threadContext: {
                filePath: filePath
            },
            status: 1 // 1 for active
        };
        try {
            const response = await axios.post(url, commentThread, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });
            return response.data;
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Failed to add comment to ${filePath}: ${error.message}`);
            } else {
                vscode.window.showErrorMessage(`Failed to add comment to ${filePath}: Unknown error`);
            }
        }
    }

    async getCommentThreads(prItem: any, azureDevOpsProject: string): Promise<any[]> {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;
        try {
            const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads?api-version=7.2-preview.1`;

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });
            return response.data.value || [];
        } catch (error: unknown) {
            vscode.window.showErrorMessage(`Failed to fetch comment threads: ${error}`);
            return [];
        }
    }
    //#endregion

    //#region Webview Content

    async getAddCommentWebviewContent(filePath: string): Promise<string> {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Add Comment</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                textarea { width: 100%; height: 100px; padding: 10px; margin-top: 10px; box-sizing: border-box; }
                button { padding: 10px 20px; margin-top: 10px; background-color: #007acc; color: white; border: none; cursor: pointer; }
            </style>
        </head>
        <body>
            <h2>Add Comment to ${filePath}</h2>
            <textarea id="comment" placeholder="Enter your comment"></textarea>
            <button onclick="submitComment()">Submit</button>
            <script>
                const vscode = acquireVsCodeApi();
                function submitComment() {
                    const comment = document.getElementById('comment').value;
                    vscode.postMessage({
                        command: 'submit',
                        text: comment
                    });
                }
            </script>
        </body>
        </html>`;
    }

    async getCommentWebviewContent(threads: any[]): Promise<string> {
        // Step 1: Sort threads by the most recent comment or thread creation
        const sortedThreads = threads.sort((b: any, a: any) => {
            const lastCommentA = a.comments.length > 0 ? new Date(a.comments[a.comments.length - 1].publishedDate) : new Date(a.publishedDate);
            const lastCommentB = b.comments.length > 0 ? new Date(b.comments[b.comments.length - 1].publishedDate) : new Date(b.publishedDate);
            return lastCommentA.getTime() - lastCommentB.getTime(); // Sort by the most recent activity
        });

        const threadsHtml = sortedThreads.map(thread => {
            const filePath = thread.threadContext?.filePath ? thread.threadContext.filePath : null;
            const threadId = thread.id; // Get the thread ID
            const threadStatus = thread.status;

            // Step 2: Sort comments by publishedDate in ascending order (older first, newer last)
            const sortedComments = thread.comments.sort((a: any, b: any) => new Date(a.publishedDate).getTime() - new Date(b.publishedDate).getTime());

            // Format all the comments in the thread
            const commentsHtml = sortedComments.map((comment: any) => {
                // Generate avatar URL based on the author's initials
                const initials = comment.author.displayName.split(' ').map((name: string) => name.charAt(0)).join('');
                const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${initials}&backgroundColor=00acc1,1e88e5,5e35b1,7cb342,8e24aa,039be5,43a047,00897b,3949ab,c0ca33,d81b60`;
                const clickableContent = this.makeUrlsClickable(comment.content);

                return `
                    <div class="comment">
                        <div class="comment-header">
                            <img src="${avatarUrl}" class="avatar" alt="${comment.author.displayName}" />
                            <div class="comment-details">
                                <p class="comment-author">${comment.author.displayName}</p>
                                <p class="comment-date">${new Date(comment.publishedDate).toLocaleString()}</p>
                            </div>
                        </div>
                        <div class="comment-content">${clickableContent}</div>
                    </div>
                `;
            }).join('');

            // File path (if exists) and buttons at the end of the thread
            const filePathHtml = filePath ? `<div class="file-path">Related to file: <strong>${filePath}</strong></div>` : `<div class="file-path"> </div>`;




            let replySection: string;
            if (threadStatus === "fixed") {
                replySection = `<!-- Add Reply and Resolve buttons at the end of the thread -->
                    <div class="reply-section">
                    <button class="reactivate-button" data-thread-id="${threadId}">Reactivate</button>
                     </div>`;

            } else {
                replySection = `<!-- Add Reply and Resolve buttons at the end of the thread -->
                    <div class="reply-section">
                    <textarea class="reply-input" placeholder="Write a reply..."></textarea>
                    <button class="reply-button" data-thread-id="${threadId}">Reply</button>
                    <button class="resolve-button" data-thread-id="${threadId}">Resolve</button>
                     </div>`;

            }


            return `
                <div class="thread">
                    <div class="thread-header">
                        ${filePathHtml}
                        <span class="thread-status-${threadStatus}">${threadStatus}</span> <!-- Thread status on the top right -->
                    </div>
                    ${commentsHtml}
                    ${replySection}
                </div>
            `;
        }).join('');

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Comments</title>
            <style>
                /* Add your CSS styles here */
                    .thread-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    .thread-status-active {
                        font-weight: bold;
                        color: green;
                    }
                    .thread-status-fixed {
                        font-weight: bold;
                        color: gray;
                    }
                    .thread-status-undefined {
                        font-weight: bold;
                        opacity: 0;
                        color: gray;
                    }
                    body { font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px; }
                    .threads { margin-bottom: 20px; }
                    .thread { background-color: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
                    .file-path { font-size: 0.9em; margin-bottom: 10px; color: #888; }
                    .comment { border-top: 1px solid #e0e0e0; padding: 10px 0; }
                    .comment:first-child { border-top: none; }
                    .comment-header { display: flex; align-items: center; margin-bottom: 5px; }
                    .avatar { border-radius: 50%; width: 40px; height: 40px; margin-right: 10px; }
                    .comment-details { display: flex; flex-direction: column; }
                    .comment-author { font-weight: bold; margin: 0; }
                    .comment-date { font-size: 0.85em; color: #888; margin: 0; }
                    .comment-content { background-color: #f9f9f9; padding: 10px; border-radius: 5px; white-space: pre-wrap; margin-top: 5px; }
                    textarea { width: 100%; height: 100px; margin-top: 10px; padding: 10px; border-radius: 5px; border: 1px solid #ccc; box-sizing: border-box; }
                    form { display: flex; flex-direction: column; align-items: flex-start; }
                    button { margin-top: 10px; padding: 10px 15px; border: none; border-radius: 5px; background-color: #007acc; color: #fff; cursor: pointer; }
                    button:hover { background-color: #005f99; }
                    .resolve-button { background-color: #007acc; color: #fff; padding: 8px 15px; border: none; border-radius: 5px; cursor: pointer; }
                    .resolve-button:hover { background-color: #005f99; }
            </style>
        </head>
        <body>
           <h3>Add Comment</h3>
            <form id="commentForm">
                <textarea id="comment" placeholder="Enter your comment here..."></textarea>
                <br>
                <button type="button" onclick="submitComment()">Submit</button>
            </form>
            <div class="threads">
                <h3>Existing Comments</h3>
                ${threadsHtml || '<p>No existing comments found.</p>'}
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                function submitComment() {
                    const comment = document.getElementById('comment').value;
                    vscode.postMessage({
                        command: 'submit',
                        text: comment
                    });
                }
                // Handle reply button click, including threadId
                document.querySelectorAll('.reply-button').forEach(button => {
                    button.addEventListener('click', (event) => {
                        const threadId = event.target.getAttribute('data-thread-id');
                        const replyText = event.target.previousElementSibling.value;
                        vscode.postMessage({
                            command: 'reply',
                            threadId: threadId, // Send threadId with the reply
                            replyText: replyText
                        });
                    });
                });

                // Handle resolve button click, including threadId
                document.querySelectorAll('.resolve-button').forEach(button => {
                    button.addEventListener('click', (event) => {
                        const threadId = event.target.getAttribute('data-thread-id');
                        vscode.postMessage({
                            command: 'resolve',
                            threadId: threadId // Send threadId for resolving
                        });
                    });
                });
                // Handle reactivate button click, including threadId
                document.querySelectorAll('.reactivate-button').forEach(button => {
                    button.addEventListener('click', (event) => {
                        const threadId = event.target.getAttribute('data-thread-id');
                        vscode.postMessage({
                            command: 'reactivate',
                            threadId: threadId // Send threadId for resolving
                        });
                    });
                });
            </script>
        </body>
        </html>`;
    }

    async openCommentWebview(prItem: any, azureDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        // Fetch existing comment threads for the pull request
        const threads = await this.getCommentThreads(prItem, azureDevOpsProject);
        // Sort threads by the latest comment date
        const sortedThreads = threads.sort((a: any, b: any) => {
            const latestCommentA = a.comments.reduce((latest: any, comment: any) =>
                new Date(comment.publishedDate).getTime() > new Date(latest.publishedDate).getTime() ? comment : latest,
                a.comments[0]
            );

            const latestCommentB = b.comments.reduce((latest: any, comment: any) =>
                new Date(comment.publishedDate).getTime() > new Date(latest.publishedDate).getTime() ? comment : latest,
                b.comments[0]
            );

            return new Date(latestCommentB.publishedDate).getTime() - new Date(latestCommentA.publishedDate).getTime();
        });
        // Create and show a new webview panel
        const panel = vscode.window.createWebviewPanel(
            'addComment', // Identifies the type of the webview. Used internally
            `Add Comment to PR #${pullRequestId}`, // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in
            {
                enableScripts: true // Enable javascript in the webview
            }
        );

        // Set the HTML content of the webview panel, passing the threads as a parameter
        panel.webview.html = await this.getCommentWebviewContent(sortedThreads);

        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'submit':
                    const comment = message.text;
                    if (comment) {
                        await this.addCommentToPullRequest(prItem, comment, azureDevOpsProject);
                        await this.refreshWebView(panel, prItem, azureDevOpsProject);
                    } else {
                        vscode.window.showErrorMessage('Comment cannot be empty.');

                    }
                    break;

                case 'reply':
                    const replyText = message.replyText;
                    if (replyText) {
                        await this.replyToComment(prItem, message.threadId, replyText, azureDevOpsProject);
                        await this.refreshWebView(panel, prItem, azureDevOpsProject);
                    } else {
                        vscode.window.showErrorMessage('Reply cannot be empty.');

                    }
                    break;

                case 'resolve':

                    await this.resolveComment(prItem, message.threadId, azureDevOpsProject);
                    await this.refreshWebView(panel, prItem, azureDevOpsProject);
                    break;

                case 'reactivate':

                    await this.reactivateComment(prItem, message.threadId, azureDevOpsProject);
                    await this.refreshWebView(panel, prItem, azureDevOpsProject);
                    break;
            }
        });
    }

    async refreshWebView(panel: vscode.WebviewPanel, prItem: any, azureDevOpsProject: string) {
        if (!azureDevOpsProject) {
            vscode.window.showErrorMessage('No project selected.');
            return;
        }
        // Fetch existing comment threads for the pull request
        const threads = await this.getCommentThreads(prItem, azureDevOpsProject);
        // Sort threads by the latest comment date
        const sortedThreads = threads.sort((a: any, b: any) => {
            const latestCommentA = a.comments.reduce((latest: any, comment: any) =>
                new Date(comment.publishedDate).getTime() > new Date(latest.publishedDate).getTime() ? comment : latest,
                a.comments[0]
            );

            const latestCommentB = b.comments.reduce((latest: any, comment: any) =>
                new Date(comment.publishedDate).getTime() > new Date(latest.publishedDate).getTime() ? comment : latest,
                b.comments[0]
            );

            return new Date(latestCommentB.publishedDate).getTime() - new Date(latestCommentA.publishedDate).getTime();
        });

        // Generate the updated HTML content
        const updatedContent = await this.getCommentWebviewContent(sortedThreads);

        // Update the WebView with new content
        panel.webview.html = updatedContent;
    }

    //#endregion

    //#region PBI functions

    async getCurrentSprintPBIs(azureDevOpsProject: string, team: string): Promise<any[]> {
        const url = `${this.azureDevOpsOrgUrl}/${azureDevOpsProject}/${team}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=${this.azureDevOpsApiVersion}`;

        try {
            // Fetch the current iteration (sprint)
            const iterationResponse = await axios.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });

            // Fetch PBIs for the current sprint (using the iteration id)
            const iterationPath = iterationResponse.data.value[0].path;
            const pbiUrl = `${this.azureDevOpsOrgUrl}/_apis/wit/wiql?api-version=${this.azureDevOpsApiVersion}`;

            const pbiQuery = {
                "query": `SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.WorkItemType] = 'Product Backlog Item' AND [System.IterationPath] = '${iterationPath}'`
            };

            const pbiResponse = await axios.post(pbiUrl, pbiQuery, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });

            return pbiResponse.data.workItems || [];

        } catch (error) {
            return this.handleError(error);
        }
    }


    async getPBIDetails(azureSelectedDevOpsProject: string, team: string): Promise<any[]> {
        // Step 1: Get the current sprint PBIs
        const sprintPBIs = await this.getCurrentSprintPBIs(azureSelectedDevOpsProject, team);

        // Step 2: Prepare to fetch detailed information for each PBI in parallel
        const pbiDetailPromises = sprintPBIs.map(async (pbi: any) => {
            const pbiId = pbi.id;
            const pbiDetailsUrl = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/wit/workitems/${pbiId}?api-version=${this.azureDevOpsApiVersion}`;

            // Fetch PBI details
            try {
                const response = await axios.get(pbiDetailsUrl, {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                    }
                });
                return response.data; // Return the detailed information for this PBI
            } catch (error) {
                this.handleError(error);
                return null; // Return null if there's an error, but continue with the rest
            }
        });

        // Step 3: Use Promise.all to fetch details for all PBIs concurrently
        const pbiDetails = await Promise.all(pbiDetailPromises);

        // Filter out any null values (in case any fetches failed)
        return pbiDetails.filter(pbi => pbi !== null);
    }


    //#endregion

    //#region Utility functions


    async getTeamIdFromName(azureDevOpsProject: string, teamName: string): Promise<string | null> {
        const url = `${this.azureDevOpsOrgUrl}/_apis/projects/${azureDevOpsProject}/teams/${teamName}?api-version=7.1-preview.1`;


        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });

            const teamId = response.data.id; // The team ID is in the 'id' field
            return teamId;

        } catch (error) {
            // this.handleError(error);
            return null;
        }
    }


    makeUrlsClickable(text: string): string {
        // Regular expression to find URLs in the text
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;

        // Replace URLs in the text with <a> tags
        return text.replace(urlRegex, (url) => {
            return `<a href="${url}" target="_blank">${url}</a>`;
        });
    }
    async getLoggedInUserId() {
        try {

            const userResponse = await axios.get(
                `${this.azureDevOpsOrgUrl}/_apis/connectionData`,
                {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                    }
                }
            );

            return userResponse.data.authenticatedUser.id;

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }
    //#endregion

    public async monitorGitCommits(gitApi: any, configurationService: any) {
        gitApi.repositories.forEach(async (repo: any) => {
            const repoPath = repo.rootUri.fsPath;
            const remoteUrl = this.getRemoteUrl(repo);


            // Ensure remoteUrl is not null and matches the configured Azure DevOps URL
            if (!remoteUrl || !remoteUrl.startsWith(this.azureDevOpsOrgUrl)) {
                logger.debug(`Skipping repository '${repoPath}' as it's not in Azure DevOps (${remoteUrl})`);
                return;
            }

            if (remoteUrl) {
                logger.debug(`Remote URL detected: ${remoteUrl}`);
                const detectedProject = this.extractAzureDevOpsProject(remoteUrl);

                if (detectedProject) {
                    logger.debug(`Detected Azure DevOps project: ${detectedProject}`);
                    await configurationService.updateSelectedProjectInGlobalState(detectedProject);
                }
            }

            repo.onDidCommit(async () => {
                logger.debug("Commit detected!");

                const branchName = repo.state.HEAD?.name;
                if (!branchName) {
                    logger.debug("No active branch found.");
                    return;
                }

                logger.debug(`Commit detected in repo: ${repoPath}`);

                const isNewBranch = await this.isBranchNew(repo, branchName);
                logger.debug(`Is new branch? ${isNewBranch}`);

                if (isNewBranch) {
                    logger.debug(`Would you like to create a Pull Request for branch ${branchName}`);
                    const choice = await vscode.window.showInformationMessage(
                        `Would you like to create a Pull Request for branch ${branchName} ?`,
                        'Yes',
                        'No'
                    );

                    if (choice === 'Yes') {
                        logger.debug("User accepted PR creation.");

                        // Fetch the selected Azure DevOps project
                        const selectedProject = configurationService.getSelectedProjectFromGlobalState();
                        if (!selectedProject) {
                            vscode.window.showErrorMessage("No project selected for PR creation.");
                            return;
                        }

                        // Find the corresponding Azure DevOps repository
                        const repositories = await this.getRepositories(selectedProject);
                        const matchingRepo = repositories.find((r: any) => repoPath.includes(r.name));

                        if (!matchingRepo) {
                            vscode.window.showErrorMessage(`No matching Azure DevOps repository found for '${repoPath}'.`);
                            return;
                        }

                        logger.debug(`Matched Azure DevOps repo: ${matchingRepo.name}`);

                        // Call existing function for PR creation
                        const azureDevOpsTeamId = await this.getTeamIdFromName(selectedProject, configurationService.getConfiguration().azureDevOpsTeam);
                        await this.openCreatePullRequestForm(selectedProject, azureDevOpsTeamId!, matchingRepo.id, branchName);

                        // Refresh pull request view
                        vscode.commands.executeCommand('azureDevopsPullRequest.refreshPullRequests');
                    }
                }
            });
        });

        logger.debug("Git commit monitoring initialized.");
    }


    private async isBranchNew(repo: any, branchName: string): Promise<boolean> {
        const mainBranches = ['main', 'master', 'develop'];
        return !mainBranches.includes(branchName);
    }


    private extractAzureDevOpsProject(remoteUrl: string): string | null {
        if (!remoteUrl.startsWith(this.azureDevOpsOrgUrl)) {
            vscode.window.showErrorMessage(`Invalid Azure DevOps remote URL: ${remoteUrl}`);
            return null;
        }
        const projectPath = remoteUrl.replace(this.azureDevOpsOrgUrl, "");
        const parts = projectPath.split('/');
        if (parts.length >= 2) {
            return parts[1]; // The project name is the second part
        }

        vscode.window.showErrorMessage(`Failed to detect Azure DevOps project from remote URL: ${remoteUrl}`);
        return null;
    }


    private getRemoteUrl(repo: any): string | null {
        if (repo.state.remotes.length > 0 && repo.state.remotes[0].fetchUrl) {
            return repo.state.remotes[0].fetchUrl;
        }
        return null;
    }


    //#region Error handling

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
    //     return [];
    // }

    private async handleError(error: unknown) {
        await ErrorHandler.handleError(error, 'PullRequestService');
        return [];
    }

    //#endregion


}


