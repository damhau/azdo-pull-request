import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';
import { ConfigurationService } from './ConfigurationService';

export class PullRequestProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> = new vscode.EventEmitter<TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private repositories: RepositoryItem[] = [];
    private loading: boolean = false; // State to show if loading

    private azureDevOpsOrgUrl: string;
    private userAgent: string;
    private azureDevOpsApiVersion: string;
    private azureDevOpsPat: string;

    constructor(orgUrl: string, userAgent: string, apiVersion: string, pat: string, private configurationService: ConfigurationService) {
        this.azureDevOpsOrgUrl = orgUrl;
        this.userAgent = userAgent;
        this.azureDevOpsApiVersion = apiVersion;
        this.azureDevOpsPat = pat;
        this.refresh();
    }



    refresh(): void {
        this.loading = true;
        this._onDidChangeTreeData.fire(); // Trigger refresh to show loading item
        this.fetchAllRepositoriesAndPullRequests().then(repos => {
            this.repositories = repos;
            this.loading = false;
            this._onDidChangeTreeData.fire(); // Trigger another refresh after loading
        });
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }



    // getTreeItem(element: TreeItem): vscode.TreeItem {
    //     const treeItem = new vscode.TreeItem(element.label, element.collapsibleState);

    //     if (element instanceof PullRequestItem) {
    //         treeItem.command = {
    //             command: 'azureDevopsPullRequest.viewPullRequestDetails',
    //             title: 'View Pull Request Details',
    //             arguments: [element]
    //         };
    //     }

    //     return treeItem;
    // }


    getChildren(element?: TreeItem): Thenable<TreeItem[]> {




        if (this.loading) {
            return Promise.resolve([new LoadingItem()]);
        }
        if (!element) {
            return Promise.resolve(this.repositories);
        } else if (element instanceof RepositoryItem) {
            return Promise.resolve(element.pullRequests);
        } else {
            return Promise.resolve([]);
        }
    }

    private async fetchAllRepositoriesAndPullRequests(): Promise<RepositoryItem[]> {


        try {

            const azureDevOpsSelectedProject = this.configurationService.getSelectedProjectFromGlobalState();
            // Check if no project is selected
            if (!azureDevOpsSelectedProject) {
                return [];
            }




            // Step 1: Fetch all repositories
            const repoResponse = await axios.get(`${this.azureDevOpsOrgUrl}/${azureDevOpsSelectedProject}/_apis/git/repositories?api-version=${this.azureDevOpsApiVersion}`, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`


                }
            });

            const repositories = repoResponse.data.value;

            // Step 2: Fetch pull requests for all repositories in parallel
            const repositoryItems = await Promise.all(repositories.map(async (repo: any) => {
                try {
                    const prResponse = await axios.get(`${this.azureDevOpsOrgUrl}/${azureDevOpsSelectedProject}/_apis/git/repositories/${repo.id}/pullrequests?api-version=${this.azureDevOpsApiVersion}`, {
                        headers: {
                            'User-Agent': this.userAgent,
                            'Authorization': `Basic ${Buffer.from(':' + this.azureDevOpsPat).toString('base64')}`


                        }
                    });
                    const pullRequests = prResponse.data.value.map((pr: any) => {
                        return new PullRequestItem(pr.title, pr.pullRequestId, repo.name, pr.description, pr.createdBy.displayName, pr.creationDate.split("T")[0]);
                    });

                    // Only return RepositoryItem if it has pull requests
                    if (pullRequests.length > 0) {
                        return new RepositoryItem(repo.name, repo.id,  pullRequests);
                    }
                } catch (error: unknown) {
                    return this.handleError(error);
                }
                return null;
            }));

            // Filter out null values and return only repositories with pull requests
            return repositoryItems.filter((item): item is RepositoryItem => item !== null);
            // } catch (error) {
            //     vscode.window.showErrorMessage(`Failed to fetch repositories and pull requests: ${error.message}`);
            //     return [];
            // }
        } catch (error: unknown) {
            return this.handleError(error);
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
                await vscode.window.showErrorMessage(`Error: ${axiosError.message}`);
            }
        } else {
            await vscode.window.showErrorMessage(`An unknown error occurred: ${error}`);
        }
        return [];
    }

}

class TreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

class RepositoryItem extends TreeItem {
    constructor(
        public readonly repoName: string,
        public readonly repoId: string,
        public readonly pullRequests: PullRequestItem[]
    ) {
        super(repoName, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'repositoryItem';
        this.iconPath = new vscode.ThemeIcon('repo');
    }
}

// Loading indicator item to show during refresh
class LoadingItem extends TreeItem {
    constructor() {
        super('Loading...', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('sync~spin'); // Shows the spinner icon
    }
}

// Loading indicator item to show during refresh
class NoProjectItem extends TreeItem {
    constructor() {
        super('Select a project to show repositories', vscode.TreeItemCollapsibleState.None);
        //this.iconPath = new vscode.ThemeIcon('sync~spin'); // Shows the spinner icon
    }
}

class PullRequestItem extends TreeItem {
    constructor(
        public readonly prTitle: string,
        private readonly prId: number,
        private readonly repoName: string,
        private readonly prDescription: string,
        private readonly prCreatedBy: string,
        private readonly prcreationDate: string,
    ) {
        super(prTitle, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'pullRequestItem';
        this.tooltip = `Pull Request ID: ${prId}\nCreated by: ${prCreatedBy}\nCreation date: ${prcreationDate}\nDescription: ${prDescription ? prDescription : 'No description provided.'}\n`;
        //this.description = `ID: ${prId}`;
        this.iconPath = new vscode.ThemeIcon('git-pull-request');
    }
}