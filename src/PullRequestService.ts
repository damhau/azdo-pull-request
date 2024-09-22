import axios, { AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import * as vscode from 'vscode';

axiosRetry(axios, {
    retries: 3, // Number of retries (Defaults to 3)
 });

export class PullRequestService {
    private azureDevOpsOrgUrl: string;
    private azureDevOpsProject: string;
    private userAgent: string;
    private azureDevOpsApiVersion: string;
    private azureDevOpsPat: string;

    constructor(orgUrl: string, project: string, userAgent: string, apiVersion: string, pat: string) {
        this.azureDevOpsOrgUrl = orgUrl;
        this.azureDevOpsProject = project;
        this.userAgent = userAgent;
        this.azureDevOpsApiVersion = apiVersion;
        this.azureDevOpsPat = pat;
    }





    async abandonPullRequest(prItem: any) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;
        const url = `${this.azureDevOpsOrgUrl}/${this.azureDevOpsProject}/_apis/git/repositories/${repoName}/pullrequests/${pullRequestId}?api-version=${this.azureDevOpsApiVersion}`;

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
                { headers: {
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
                    progress.report({ increment: i*10, message: title });
                  }, 10000);
                }
               }
              );


        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async openCreatePullRequestForm() {
        const repository = await vscode.window.showQuickPick(this.getRepositories(), {
            placeHolder: 'Select the repository for the pull request'
        });

        if (!repository) {
            vscode.window.showErrorMessage('Repository is required to create a pull request.');
            return;
        }

        const sourceBranch = await vscode.window.showQuickPick(this.getBranches(repository), {
            placeHolder: 'Select the source branch for the pull request'
        });

        if (!sourceBranch) {
            vscode.window.showErrorMessage('Source branch is required to create a pull request.');
            return;
        }

        const targetBranch = 'main'; // Assuming main or default branch

        const title = await vscode.window.showInputBox({
            prompt: 'Enter the title for the pull request'
        });

        if (!title) {
            vscode.window.showErrorMessage('Title is required to create a pull request.');
            return;
        }

        const description = await vscode.window.showInputBox({
            prompt: 'Enter the description for the pull request (optional)'
        });

        await this.createPullRequest(repository, sourceBranch, targetBranch, title, description || '');
    }

    async createPullRequest(repository: string, sourceBranch: string, targetBranch: string, title: string, description: string) {
        const url = `${this.azureDevOpsOrgUrl}/${this.azureDevOpsProject}/_apis/git/repositories/${repository}/pullrequests?api-version=${this.azureDevOpsApiVersion}`;

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

            vscode.window.showInformationMessage(`Pull Request Created: ${response.data.pullRequestId}`);


        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async getRepositories(): Promise<string[]> {
        const url = `${this.azureDevOpsOrgUrl}/${this.azureDevOpsProject}/_apis/git/repositories?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(
                url,
                {  headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                } }
            );
            return response.data.value.map((repo: any) => repo.name); // Return repository IDs
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fetch repo: ${error.message}`);
            return [];
        }
    }

    async getRepositoriesAll(): Promise<string[]> {
        const url = `${this.azureDevOpsOrgUrl}/${this.azureDevOpsProject}/_apis/git/repositories?api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(
                url,
                {  headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                } }
            );
            return response.data; // Return repository IDs
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fetch repo: ${error.message}`);
            return [];
        }
    }


    async getBranches(repositoryId: string): Promise<string[]> {
        const url = `${this.azureDevOpsOrgUrl}/${this.azureDevOpsProject}/_apis/git/repositories/${repositoryId}/refs?filter=heads/&api-version=${this.azureDevOpsApiVersion}`;

        try {
            const response = await axios.get(
                url,
                { headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                } }
            );
            return response.data.value.map((ref: any) => ref.name.replace('refs/heads/', ''));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fetch branches: ${error.message}`);
            return [];
        }
    }



    async approvePullRequest(prItem: any) {
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
                const url = `${this.azureDevOpsOrgUrl}/${this.azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/reviewers/${reviewerId}?api-version=${this.azureDevOpsApiVersion}`;
                // Step 2: Add yourself as a reviewer and set vote to 10 (Approve)
                const response = await axios.put(
                    url,
                    { vote: 10 }, // Set the vote to -10 (reject)
                    { headers: {
                        'User-Agent': this.userAgent,
                        'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                    } }
                );

                progress.report({ message: `Done: ${pullRequestId}` });
                await new Promise(resolve => setTimeout(resolve, 2000));
                // Refresh the pull request list after approving

            });

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }


    async rejectPullRequest(prItem: any) {
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
                const url = `${this.azureDevOpsOrgUrl}/${this.azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/reviewers/${reviewerId}?api-version=${this.azureDevOpsApiVersion}`;
                // Step 2: Add yourself as a reviewer and set vote to 10 (Approve)
                const response = await axios.put(
                    url,
                    { vote: -10 }, // Set the vote to -10 (reject)
                    { headers: {
                        'User-Agent': this.userAgent,
                        'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`
                    } }
                );

                progress.report({ message: `Done: ${pullRequestId}` });
                await new Promise(resolve => setTimeout(resolve, 2000));
                // Refresh the pull request list after approving

            });

        } catch (error: unknown) {
            return this.handleError(error);
        }
    }

    async addCommentToPullRequest(prItem: any) {
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
                const url = `${this.azureDevOpsOrgUrl}/${this.azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads?api-version=${this.azureDevOpsApiVersion}`;

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


    async addCommentToPullRequest2(prItem: any, comment: string) {
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
                const url = `${this.azureDevOpsOrgUrl}/${this.azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads?api-version=${this.azureDevOpsApiVersion}`;

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


    // async openCommentWebview(prItem: any) {
    //     const pullRequestId = prItem.prId;
    //     const repoName = prItem.repoName;

    //     // Create and show a new webview panel
    //     const panel = vscode.window.createWebviewPanel(
    //         'addComment', // Identifies the type of the webview. Used internally
    //         `Add Comment to PR #${pullRequestId}`, // Title of the panel displayed to the user
    //         vscode.ViewColumn.One, // Editor column to show the new webview panel in
    //         {
    //             enableScripts: true // Enable javascript in the webview
    //         }
    //     );

    //     // Set the HTML content of the webview panel
    //     panel.webview.html = this.getWebviewContent();

    //     // Handle messages from the webview
    //     panel.webview.onDidReceiveMessage(
    //         async message => {
    //             if (message.command === 'submit') {
    //                 const comment = message.text;
    //                 if (comment) {
    //                     await this.addCommentToPullRequest2(prItem, comment);
    //                     panel.dispose(); // Close the panel after adding the comment
    //                 } else {
    //                     vscode.window.showErrorMessage('Comment cannot be empty.');
    //                 }
    //             }
    //         },
    //         undefined,
    //         []
    //     );
    // }

    // // Method to return the HTML content for the webview
    // getWebviewContent(): string {
    //     return `
    //     <!DOCTYPE html>
    //     <html lang="en">
    //     <head>
    //         <meta charset="UTF-8">
    //         <meta name="viewport" content="width=device-width, initial-scale=1.0">
    //         <title>Add Comment</title>
    //         <style>
    //             body { font-family: Arial, sans-serif; }
    //             textarea { width: 100%; height: 150px; }
    //             button { margin-top: 10px; padding: 5px 10px; }
    //         </style>
    //     </head>
    //     <body>
    //         <h2>Add Comment</h2>
    //         <form id="commentForm">
    //             <textarea id="comment" placeholder="Enter your comment here..."></textarea>
    //             <br>
    //             <button type="button" onclick="submitComment()">Submit</button>
    //         </form>
    //         <script>
    //             const vscode = acquireVsCodeApi();
    //             function submitComment() {
    //                 const comment = document.getElementById('comment').value;
    //                 vscode.postMessage({
    //                     command: 'submit',
    //                     text: comment
    //                 });
    //             }
    //         </script>
    //     </body>
    //     </html>`;
    // }

    async openCommentWebview(prItem: any) {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;

        // Fetch existing comment threads for the pull request
        const threads = await this.getCommentThreads(prItem);

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
                        await this.addCommentToPullRequest2(prItem, comment);
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
    async getCommentThreads(prItem: any): Promise<any[]> {
        const pullRequestId = prItem.prId;
        const repoName = prItem.repoName;
        try {
            const url = `${this.azureDevOpsOrgUrl}/${this.azureDevOpsProject}/_apis/git/repositories/${repoName}/pullRequests/${pullRequestId}/threads?api-version=7.2-preview.1`;

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

    // getWebviewContent(threads: any[]): string {
    //     const threadsHtml = threads.map(thread => {
    //         // Sort comments by publishedDate in descending order (newest first)
    //         const sortedComments = thread.comments.sort((a: any, b: any) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime());

    //         const comments = sortedComments.map((comment: any) => `
    //             <div class="comment">
    //                 <div class="comment-header">
    //                     <img src="https://via.placeholder.com/40" class="avatar" alt="User Avatar" />
    //                     <div class="comment-details">
    //                         <p class="comment-author">${comment.author.displayName}</p>
    //                         <p class="comment-date">${new Date(comment.publishedDate).toLocaleString()}</p>
    //                     </div>
    //                 </div>
    //                 <div class="comment-content">${comment.content}</div>
    //             </div>
    //         `).join('');

    //         return `
    //             <div class="thread">
    //                 ${comments}
    //             </div>
    //         `;
    //     }).join('');

    //     return `
    //     <!DOCTYPE html>
    //     <html lang="en">
    //     <head>
    //         <meta charset="UTF-8">
    //         <meta name="viewport" content="width=device-width, initial-scale=1.0">
    //         <title>Add Comment</title>
    //         <style>
    //             body { font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px; }
    //             .threads { margin-bottom: 20px; }
    //             .thread { background-color: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
    //             .comment { border-top: 1px solid #e0e0e0; padding: 10px 0; }
    //             .comment:first-child { border-top: none; }
    //             .comment-header { display: flex; align-items: center; margin-bottom: 5px; }
    //             .avatar { border-radius: 50%; width: 40px; height: 40px; margin-right: 10px; }
    //             .comment-details { display: flex; flex-direction: column; }
    //             .comment-author { font-weight: bold; margin: 0; }
    //             .comment-date { font-size: 0.85em; color: #888; margin: 0; }
    //             .comment-content { background-color: #f9f9f9; padding: 10px; border-radius: 5px; white-space: pre-wrap; margin-top: 5px; }
    //             textarea { width: 100%; height: 100px; margin-top: 10px; padding: 10px; border-radius: 5px; border: 1px solid #ccc; }
    //             button { margin-top: 10px; padding: 10px 15px; border: none; border-radius: 5px; background-color: #007acc; color: #fff; cursor: pointer; }
    //             button:hover { background-color: #005f99; }
    //         </style>
    //     </head>
    //     <body>
    //         <h2>Add Comment</h2>
    //         <form id="commentForm">
    //             <textarea id="comment" placeholder="Enter your comment here..."></textarea>
    //             <br>
    //             <button type="button" onclick="submitComment()">Submit</button>
    //         </form>
    //         <script>
    //             const vscode = acquireVsCodeApi();
    //             function submitComment() {
    //                 const comment = document.getElementById('comment').value;
    //                 vscode.postMessage({
    //                     command: 'submit',
    //                     text: comment
    //                 });
    //             }
    //         </script>

    //     </body>
    //     </html>`;
    // }




    // getWebviewContent(threads: any[]): string {
    //     const threadsHtml = threads.map(thread => {
    //         // Sort comments by publishedDate in descending order (newest first)
    //         const sortedComments = thread.comments.sort((a: any, b: any) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime());

    //         const comments = sortedComments.map((comment: any) => `
    //             <div class="comment">
    //                 <p><strong>${comment.author.displayName}</strong> (${new Date(comment.publishedDate).toLocaleString()}):</p>
    //                 <p class="comment-content">${comment.content}</p>
    //             </div>
    //         `).join('');

    //         return `
    //             <div class="thread">
    //                 ${comments}
    //             </div>
    //         `;
    //     }).join('');

    //     return `
    //     <!DOCTYPE html>
    //     <html lang="en">
    //     <head>
    //         <meta charset="UTF-8">
    //         <meta name="viewport" content="width=device-width, initial-scale=1.0">
    //         <title>Add Comment</title>
    //         <style>
    //             body { font-family: Arial, sans-serif; }
    //             .threads { margin-bottom: 20px; }
    //             .thread { border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; }
    //             .comment { border-top: 1px solid #eee; padding: 5px; }
    //             .comment-content { white-space: pre-wrap; } /* Ensure new lines are respected */
    //             textarea { width: 100%; height: 100px; }
    //             button { margin-top: 10px; padding: 5px 10px; }
    //         </style>
    //     </head>
    //     <body>
    //         <h3>Add Comment</h3>
    //         <form id="commentForm">
    //             <textarea id="comment" placeholder="Enter your comment here..."></textarea>
    //             <br>
    //             <button type="button" onclick="submitComment()">Submit</button>
    //         </form>
    //         <script>
    //             const vscode = acquireVsCodeApi();
    //             function submitComment() {
    //                 const comment = document.getElementById('comment').value;
    //                 vscode.postMessage({
    //                     command: 'submit',
    //                     text: comment
    //                 });
    //             }
    //         </script>

    //         <div class="threads">
    //             <h3>Comments</h3>
    //             ${threadsHtml || '<p>No existing comments found.</p>'}
    //         </div>
    //     </body>
    //     </html>`;
    // }

    private async handleError(error: unknown) {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            if (axiosError.response && axiosError.response.status === 401) {
                await vscode.window.showErrorMessage('Authentication failed: Invalid or expired Personal Access Token (PAT). Please update your PAT.');
            } else if (axiosError.response && axiosError.response.status === 409)
            {
                const errorMessage = axiosError.response.data.message;
                await vscode.window.showErrorMessage(errorMessage);
            }

            else {
                await vscode.window.showErrorMessage(`Error: ${axiosError.message}`);
            }
        } else {
            await vscode.window.showErrorMessage(`An unknown error occurred: ${error}`);
        }
        return [];
    }
}


