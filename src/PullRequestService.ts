import axios, { AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import * as vscode from 'vscode';

axiosRetry(axios, {
    retries: 3, // Number of retries (Defaults to 3)
});

export class PullRequestService {
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
    }

    async abandonPullRequest(prItem: any, azureSelectedDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;
        const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repoName}/pullrequests/${pullRequestId}?api-version=${this.azureDevOpsApiVersion}`;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to abandon this pull request?`,
            { modal: true },
            'Yes', 'No'
        );

        if (confirm !== 'Yes') {
            return;
        }

        try {

            const response = await axios.patch(
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

    async openCreatePullRequestForm(azureSelectedDevOpsProject: string, repositoryId?: string): Promise<boolean> {
        if (repositoryId === undefined){
            this.repository = await vscode.window.showQuickPick(this.getRepositories(azureSelectedDevOpsProject), {
                placeHolder: 'Select the repository for the pull request'
            });

            if (!this.repository) {
                vscode.window.showErrorMessage('Repository is required to create a pull request.');
                return false;
            }


        }else{

            this.repository = repositoryId;
        }


        const sourceBranch = await vscode.window.showQuickPick(this.getBranches(this.repository, azureSelectedDevOpsProject), {
            placeHolder: 'Select the source branch for the pull request'
        });

        if (!sourceBranch) {
            vscode.window.showErrorMessage('Source branch is required to create a pull request.');
            return false;
        }

        const targetBranch = await this.getDefaultBranch(this.repository, azureSelectedDevOpsProject); // Fetch the default branch dynamically
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


        const configureAutoComplete = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Do you want to enable auto complete on the pull request?'
        });

        let autoComplete: boolean;
        if (configureAutoComplete === "Yes") {
            autoComplete = true;
        } else {
            autoComplete = false;
        }

        await this.createPullRequest(this.repository, sourceBranch, targetBranch, title, description || '', azureSelectedDevOpsProject, autoComplete);
        return true;
    }

    async createPullRequest(repository: string, sourceBranch: string, targetBranch: string, title: string, description: string, azureSelectedDevOpsProject: string, enableAutoComplete: boolean) {
        const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repository}/pullrequests?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.post(
                url,
                {
                    sourceRefName: `refs/heads/${sourceBranch}`,
                    targetRefName: `refs/heads/${targetBranch}`,
                    title: title,
                    description: description
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
            const autoCompleteSetBy = await this.getLoggedInUserId();
            console.log('Auto-complete set by:', autoCompleteSetBy);
            await this.enableAutoComplete(response.data.pullRequestId, repository, azureSelectedDevOpsProject, autoCompleteSetBy);

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
            const prItem = { "repoName": repository , "prId": response.data.pullRequestId};
            await vscode.commands.executeCommand("azureDevopsPullRequest.copyPullRequestUrl", prItem);

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async enableAutoComplete(pullRequestId: number, repositoryId: string, azureSelectedDevOpsProject: string, autoCompleteSetBy: string) {
        const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}?api-version=${this.azureDevOpsApiVersion}`;

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
        console.debug('Auto-complete payload:', payload);
        try {
            const response = await axios.patch(url, payload, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });
            console.log('Auto-complete enabled for the PR:', response.data);
        } catch (error: unknown) {
            return this.handleError(error);
        }
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





    async getRepositories(azureSelectedDevOpsProject: string): Promise<string[]> {
        const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories?api-version=${this.azureDevOpsApiVersion}`;

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
            // } catch (error) {
            //     vscode.window.showErrorMessage(`Failed to fetch repo: ${error.message}`);
            //     return [];
            // }
        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async getRepositoriesAll(azureSelectedDevOpsProject: string): Promise<string[]> {
        const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories?api-version=${this.azureDevOpsApiVersion}`;

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
            return response.data; // Return repository IDs
            // } catch (error) {
            //     vscode.window.showErrorMessage(`Failed to fetch repo: ${error.message}`);
            //     return [];
            // }
        } catch (error: unknown) {
            return this.handleError(error);
        }
    }


    async getBranches(repositoryId: string, azureSelectedDevOpsProject: string): Promise<string[]> {
        const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repositoryId}/refs?filter=heads/&api-version=${this.azureDevOpsApiVersion}`;

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
            // } catch (error) {
            //     vscode.window.showErrorMessage(`Failed to fetch branches: ${error.message}`);
            //     return [];
            // }
        } catch (error: unknown) {
            return this.handleError(error);
        }
    }



    async approvePullRequest(prItem: any, azureSelectedDevOpsProject: string) {
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

                // Step 1: Retrieve the current user (reviewer) ID
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
                const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/reviewers/${reviewerId}?api-version=${this.azureDevOpsApiVersion}`;
                // Step 2: Add yourself as a reviewer and set vote to 10 (Approve)
                const response = await axios.put(
                    url,
                    { vote: 10 }, // Set the vote to -10 (reject)
                    {
                        headers: {
                            'User-Agent': this.userAgent,
                            'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                        }
                    }
                );

                progress.report({ message: `Done: ${pullRequestId}` });
                await new Promise(resolve => setTimeout(resolve, 2000));
                // Refresh the pull request list after approving

            });

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }


    async rejectPullRequest(prItem: any, azureSelectedDevOpsProject: string) {
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

                // Step 1: Retrieve the current user (reviewer) ID
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
                const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/reviewers/${reviewerId}?api-version=${this.azureDevOpsApiVersion}`;
                // Step 2: Add yourself as a reviewer and set vote to 10 (Approve)
                const response = await axios.put(
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
                // Refresh the pull request list after approving

            });

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async addCommentToPullRequest(prItem: any, azureSelectedDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        // Prompt the user to enter a comment
        const comment = await vscode.window.showInputBox({
            prompt: 'Enter your comment',
            placeHolder: 'Add a comment to the pull request',
            ignoreFocusOut: true
        });

        if (!comment) {
            vscode.window.showErrorMessage('Comment cannot be empty.');
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Adding Comment to Pull Request",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: `Adding comment to PR #${pullRequestId}` });

                // Construct the URL for adding a comment
                const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads?api-version=${this.azureDevOpsApiVersion}`;

                // Prepare the comment thread object
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

                progress.report({ message: `Comment added successfully to PR #${pullRequestId}` });
            });

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }


    async addCommentToPullRequest2(prItem: any, comment: string, azureSelectedDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Adding Comment to Pull Request",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: `Adding comment to PR #${pullRequestId}` });

                // Construct the URL for adding a comment
                const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads?api-version=${this.azureDevOpsApiVersion}`;

                // Prepare the comment thread object
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

    async openCommentWebview(prItem: any, azureSelectedDevOpsProject: string) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        // Fetch existing comment threads for the pull request
        const threads = await this.getCommentThreads(prItem, azureSelectedDevOpsProject);

        const sortedthreads = threads.sort((a: any, b: any) => {
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
        panel.webview.html = this.getWebviewContent(sortedthreads);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            async message => {
                if (message.command === 'submit') {
                    const comment = message.text;
                    if (comment) {
                        await this.addCommentToPullRequest2(prItem, comment, azureSelectedDevOpsProject);
                        panel.dispose(); // Close the panel after adding the comment
                    } else {
                        vscode.window.showErrorMessage('Comment cannot be empty.');
                    }
                }
            },
            undefined,
            []
        );
    }




    // Method to fetch comment threads from the Azure DevOps API
    async getCommentThreads(prItem: any, azureSelectedDevOpsProject: string): Promise<any[]> {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;
        try {
            const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads?api-version=7.2-preview.1`;

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

    getWebviewContent(threads: any[]): string {
        const threadsHtml = threads.map(thread => {
            // Sort comments by publishedDate in descending order (newest first)
            const sortedComments = thread.comments.sort((a: any, b: any) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime());

            const comments = sortedComments.map((comment: any) => {
                // Generate avatar URL based on the author's initials
                const initials = comment.author.displayName.split(' ').map((name: string) => name.charAt(0)).join('');
                const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${initials}&backgroundColor=00acc1,1e88e5,5e35b1,7cb342,8e24aa,039be5,43a047,00897b,3949ab,c0ca33,d81b60`;

                return `
                    <div class="comment">
                        <div class="comment-header">
                            <img src="${avatarUrl}" class="avatar" alt="${comment.author.displayName}" />
                            <div class="comment-details">
                                <p class="comment-author">${comment.author.displayName}</p>
                                <p class="comment-date">${new Date(comment.publishedDate).toLocaleString()}</p>
                            </div>
                        </div>
                        <div class="comment-content">${comment.content}</div>
                    </div>
                `;
            }).join('');

            return `
                <div class="thread">
                    ${comments}
                </div>
            `;
        }).join('');

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Add Comment</title>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px; }
                .threads { margin-bottom: 20px; }
                .thread { background-color: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
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
            </style>
        </head>
        <body>
            <h2>Add Comment</h2>
            <form id="commentForm">
                <textarea id="comment" placeholder="Enter your comment here..."></textarea>
                <br>
                <button type="button" onclick="submitComment()">Submit</button>
            </form>
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
            <div class="threads">
                <h3>Existing Comments</h3>
                ${threadsHtml || '<p>No existing comments found.</p>'}
            </div>

        </body>
        </html>`;
    }


    async getPullRequestCommits(prItem: any, azureSelectedDevOpsProject: string): Promise<any[]> {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;
        const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/commits?api-version=${this.azureDevOpsApiVersion}`;

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

    async getCommitChanges(repoName: string, commitId: string, azureSelectedDevOpsProject: string): Promise<any[]> {
        const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repoName}/commits/${commitId}/changes?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                }
            });

            return response.data.changes || [];
        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    // async openPullRequestDiffView(prItem: any, azureSelectedDevOpsProject: string) {

    //     // Fetch all commits for the pull request
    //     const commits = await this.getPullRequestCommits(prItem, azureSelectedDevOpsProject);
    //     let aggregatedChanges: any[] = [];

    //     // For each commit, fetch the changes and aggregate them
    //     for (const commit of commits) {
    //         const commitChanges = await this.getCommitChanges(prItem.repoName, commit.commitId, azureSelectedDevOpsProject);
    //         aggregatedChanges.push(...commitChanges.map(change => ({
    //             ...change,
    //             commitId: commit.commitId // Add commit ID to each change
    //         })));
    //     }

    //     // Group changes by commitId
    //     const groupedChanges = aggregatedChanges.reduce((acc, change) => {
    //         if (!acc[change.commitId]) {
    //             acc[change.commitId] = [];
    //         }
    //         acc[change.commitId].push(change);
    //         return acc;
    //     }, {});

    //     // Fetch content for each file change
    //     const changesWithContent = await Promise.all(
    //         Object.keys(groupedChanges).map(async commitId => {
    //             const changesForCommit = groupedChanges[commitId];
    //             const changesWithContentForCommit = await Promise.all(
    //                 changesForCommit
    //                 .filter((change: { item: { isFolder: any; }; }) => !change.item.isFolder)
    //                 .map(async (change: {
    //                     changeType: string; item: { url: string; path: any; };
    //                     }) => {
    //                     if (change.changeType === 'delete') {
    //                         return {
    //                             ...change
    //                         };
    //                     }else{
    //                         try {
    //                             const fileContent = await this.fetchFileContent(change.item.url);
    //                             return {
    //                                 ...change,
    //                                 content: fileContent // Add the fetched content to the change object
    //                             };
    //                         } catch (error) {
    //                             console.error(`Failed to fetch content for ${change.item.path}: ${error}`);
    //                             return null;
    //                         }
    //                     }
    //                 })
    //             );

    //             return {
    //                 commitId,
    //                 changes: changesWithContentForCommit.filter(change => change !== null)
    //             };
    //         })
    //     );

    //     // Create and show a new webview panel
    //     const panel = vscode.window.createWebviewPanel(
    //         'pullRequestDiff', // Identifies the type of the webview. Used internally
    //         `Pull Request #${prItem.prId} Changes`, // Title of the panel displayed to the user
    //         vscode.ViewColumn.One, // Editor column to show the new webview panel in
    //         {
    //             enableScripts: true // Enable javascript in the webview
    //         }
    //     );

    //     // Generate the HTML content with file contents grouped by commitId
    //     panel.webview.html = this.getDiffWebviewContent(changesWithContent);
    // }

    // async openPullRequestDiffView(prItem: any, azureSelectedDevOpsProject: string) {

    //     // Fetch all commits for the pull request
    //     const commits = await this.getPullRequestCommits(prItem, azureSelectedDevOpsProject);
    //     let aggregatedChanges: any[] = [];

    //     // For each commit, fetch the changes and aggregate them
    //     for (const commit of commits) {
    //         const commitChanges = await this.getCommitChanges(prItem.repoName, commit.commitId, azureSelectedDevOpsProject);
    //         aggregatedChanges.push(...commitChanges.map(change => ({
    //             ...change,
    //             commitId: commit.commitId // Add commit ID to each change
    //         })));
    //     }

    //     // Group changes by commitId
    //     const groupedChanges = aggregatedChanges.reduce((acc, change) => {
    //         if (!acc[change.commitId]) {
    //             acc[change.commitId] = [];
    //         }
    //         acc[change.commitId].push(change);
    //         return acc;
    //     }, {});

    //     // Use vscode.window.withProgress for fetching content
    //     const changesWithContent = await vscode.window.withProgress({
    //         location: vscode.ProgressLocation.Notification,
    //         title: "Fetching File Contents",
    //         cancellable: false
    //     }, async (progress) => {

    //         progress.report({ increment: 0, message: "Starting to fetch file contents..." });

    //         let totalFiles = Object.keys(groupedChanges).reduce((acc, commitId) => {
    //             return acc + groupedChanges[commitId].length;
    //         }, 0);
    //         let processedFiles = 0;

    //         const changesWithContentForCommits = await Promise.all(
    //             Object.keys(groupedChanges).map(async commitId => {
    //                 const changesForCommit = groupedChanges[commitId];
    //                 const changesWithContentForCommit = await Promise.all(
    //                     changesForCommit
    //                         .filter((change: { item: { isFolder: any; }; }) => !change.item.isFolder)
    //                         .map(async (change: {
    //                             changeType: string; item: { url: string; path: any; };
    //                         }) => {
    //                             if (change.changeType === 'delete') {
    //                                 processedFiles++;
    //                                 progress.report({ increment: (processedFiles / totalFiles) * 100, message: `Processed ${processedFiles} of ${totalFiles} files` });
    //                                 return {
    //                                     ...change
    //                                 };
    //                             } else {
    //                                 try {
    //                                     const fileContent = await this.fetchFileContent(change.item.url);
    //                                     processedFiles++;
    //                                     progress.report({ increment: (processedFiles / totalFiles) * 100, message: `Fetched ${processedFiles} of ${totalFiles} files` });
    //                                     return {
    //                                         ...change,
    //                                         content: fileContent // Add the fetched content to the change object
    //                                     };
    //                                 } catch (error) {
    //                                     console.error(`Failed to fetch content for ${change.item.path}: ${error}`);
    //                                     return null;
    //                                 }
    //                             }
    //                         })
    //                 );
    //                 return {
    //                     commitId,
    //                     changes: changesWithContentForCommit.filter(change => change !== null)
    //                 };
    //             })
    //         );

    //         return changesWithContentForCommits;
    //     });

    //     // Create and show a new webview panel
    //     const panel = vscode.window.createWebviewPanel(
    //         'pullRequestDiff', // Identifies the type of the webview. Used internally
    //         `Pull Request #${prItem.prId} Changes`, // Title of the panel displayed to the user
    //         vscode.ViewColumn.One, // Editor column to show the new webview panel in
    //         {
    //             enableScripts: true // Enable javascript in the webview
    //         }
    //     );

    //     // Generate the HTML content with file contents grouped by commitId
    //     panel.webview.html = this.getDiffWebviewContent(changesWithContent);
    // }

    async openPullRequestDiffView(prItem: any, azureSelectedDevOpsProject: string) {
        // Fetch all commits for the pull request
        const commits = await this.getPullRequestCommits(prItem, azureSelectedDevOpsProject);
        let aggregatedChanges: any[] = [];

        // For each commit, fetch the changes and aggregate them
        for (const commit of commits) {
            const commitChanges = await this.getCommitChanges(prItem.repoName, commit.commitId, azureSelectedDevOpsProject);
            aggregatedChanges.push(...commitChanges.map(change => ({
                ...change,
                commitId: commit.commitId // Add commit ID to each change
            })));
        }

        // Group changes by commitId
        const groupedChanges = aggregatedChanges.reduce((acc, change) => {
            if (!acc[change.commitId]) {
                acc[change.commitId] = [];
            }
            acc[change.commitId].push(change);
            return acc;
        }, {});

        // Use vscode.window.withProgress for fetching content
        const changesWithContent = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Fetching File Contents",
            cancellable: false
        }, async (progress) => {
            let processedFiles = 0;
            let totalFiles = Object.keys(groupedChanges).reduce((acc, commitId) => {
                return acc + groupedChanges[commitId].length;
            }, 0);

            // Ensure we see the initial progress report
            progress.report({ increment: 0, message: "Starting to fetch file contents..." });

            const changesWithContentForCommits = await Promise.all(
                Object.keys(groupedChanges).map(async commitId => {
                    const changesForCommit = groupedChanges[commitId];
                    const changesWithContentForCommit = await Promise.all(
                        changesForCommit
                            .filter((change: { item: { isFolder: any; }; }) => !change.item.isFolder)
                            .map(async (change: {
                                changeType: string; item: { url: string; path: any; };
                            }) => {
                                if (change.changeType === 'delete') {
                                    processedFiles++;
                                    progress.report({ increment: (processedFiles / totalFiles) * 100, message: `Processed ${processedFiles} of ${totalFiles} files` });
                                    return {
                                        ...change
                                    };
                                } else {
                                    try {
                                        const fileContent = await this.fetchFileContent(change.item.url);
                                        processedFiles++;
                                        progress.report({ increment: (processedFiles / totalFiles) * 100, message: `Fetched ${processedFiles} of ${totalFiles} files` });
                                        return {
                                            ...change,
                                            content: fileContent // Add the fetched content to the change object
                                        };
                                    } catch (error) {
                                        console.error(`Failed to fetch content for ${change.item.path}: ${error}`);
                                        return null;
                                    }
                                }
                            })
                    );
                    return {
                        commitId,
                        changes: changesWithContentForCommit.filter(change => change !== null)
                    };
                })
            );

            return changesWithContentForCommits;
        });

        // Create and show a new webview panel
        const panel = vscode.window.createWebviewPanel(
            'pullRequestDiff', // Identifies the type of the webview. Used internally
            `Pull Request #${prItem.prId} Changes`, // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in
            {
                enableScripts: true // Enable javascript in the webview
            }
        );

        // Generate the HTML content with file contents grouped by commitId
        panel.webview.html = this.getDiffWebviewContent(changesWithContent);
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


    getDiffWebviewContent(groupedChanges: any[]): string {

        const diffHtml = groupedChanges.map(commitGroup => {

            const commitId = commitGroup.commitId;
            const changes = commitGroup.changes.map((change: { item: { path: any; }; changeType: any; content: string; }) => {
                const fullPath = change.item.path; // Full path including subfolders
                //const fileName = path.basename(fullPath); // Extract only the file name
                const changeType = change.changeType;
                const content = change.content || 'No content available'; // Use fetched content
                // Wrap content in <pre> and <code> tags for code formatting
                return `
                    <div class="file-diff">
                        <h4>${fullPath} (${changeType})</h4>
                        <div class="file-path">${fullPath}</div> <!-- Display the full path for context -->
                        <pre><code class="file-content">${content}</code></pre>
                    </div>
                `;
            }).join('');

            // Return the section for each commit
            return `
                <section class="commit-section">
                    <h3>Commit ID: ${commitId}</h3>
                    ${changes}
                </section>
            `;
        }).join('');

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Pull Request Changes</title>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px; }
                .commit-section { margin-bottom: 30px; }
                .file-diff { background-color: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
                .file-path { font-size: 0.85em; color: #888; margin-bottom: 10px; }
                .file-content { padding: 10px; border-top: 1px solid #e0e0e0; white-space: pre-wrap; overflow-x: auto; }
                .add { background-color: #e6ffed; }
                .del { background-color: #ffeef0; }
                h3 { margin-top: 0; }
                h4 { margin-top: 0; }
                /* Optional Syntax Highlighting Styles */
                pre, code {
                    background-color: #f5f5f5;
                    border-radius: 4px;
                    font-size: 14px;
                    font-family: "Courier New", Courier, monospace;
                }
                pre {
                    padding: 15px;
                    overflow: auto;
                }
            </style>
            <!-- Include highlight.js CSS and JS -->
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
            <script>
                document.addEventListener("DOMContentLoaded", (event) => {
                    document.querySelectorAll("pre code").forEach((block) => {
                        hljs.highlightElement(block);
                    });
                });
            </script>
        </head>
        <body>
            <h2>Files Changed</h2>
            ${diffHtml}
        </body>
        </html>`;
    }


    async getDefaultBranch(repositoryId: string, azureSelectedDevOpsProject: string): Promise<string | null> {
        const url = `${this.azureDevOpsOrgUrl}/${azureSelectedDevOpsProject}/_apis/git/repositories/${repositoryId}?api-version=${this.azureDevOpsApiVersion}`;

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


    private async handleError(error: unknown) {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            if (axiosError.response && axiosError.response.status === 401) {
                await vscode.window.showErrorMessage('Authentication failed: Invalid or expired Personal Access Token (PAT). Please update your PAT.');
            } else if (axiosError.response && axiosError.response.status === 409) {

                await vscode.window.showErrorMessage(`${error.response?.data?.message || error.message}`);
            }

            else {
                await vscode.window.showErrorMessage(`Error: ${error.response?.data?.message || error.message}`);
            }
        } else {
            await vscode.window.showErrorMessage(`An unknown error occurred: ${error}`);
        }
        return [];
    }
}


