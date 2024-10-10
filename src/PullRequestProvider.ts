import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';
import { ConfigurationService } from './ConfigurationService';
import { PullRequestService } from './PullRequestService';

export class PullRequestProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private repositories: RepositoryItem[] = [];
    private loading: boolean = false; // State to show if loading

    constructor(private configurationService: ConfigurationService, private pullRequestService: PullRequestService) {
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

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }



    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (this.loading) {
            return Promise.resolve([new LoadingItem()]);
        }
        if (!element) {
            // Root level: return repositories
            return this.repositories; // Returns RepositoryItem[]
        } else if (element instanceof RepositoryItem) {
            // Repository level: return pull requests
            return Promise.resolve(element.pullRequests); // Returns PullRequestItem[]
        } else if (element instanceof PullRequestItem) {
            // Pull request level: return the files/folders in the pull request (build the file tree)
            const azureSelectedDevOpsProject = this.configurationService.getSelectedProjectFromGlobalState();
            const fileMap = await this.generatePullRequestItems(azureSelectedDevOpsProject!, element);

            // Build the file tree based on the file map
            let fileTree = this.buildFileTree(fileMap);

            fileTree = fileTree.sort((a, b) => {
                // Ensure folders come first
                if (a instanceof FolderItem && !(b instanceof FolderItem)) {
                    return -1; // Folders come first
                } else if (!(a instanceof FolderItem) && b instanceof FolderItem) {
                    return 1; // Files come after folders
                } else {
                    // Check if labels are undefined and handle them appropriately
                    const labelA = a.label ?? ''; // Use the nullish coalescing operator to handle undefined labels
                    const labelB = b.label ?? '';
                    return (typeof labelA === 'string' ? labelA : labelA.label).localeCompare(typeof labelB === 'string' ? labelB : labelB.label); // Sort alphabetically within the same type
                }
            });

            return Promise.resolve(fileTree); // Return the file tree (folders/files)
        } else if (element instanceof FolderItem) {
            // Folder level: return its children
            return Promise.resolve(element.children); // Return folder's children (could be files or subfolders)
        } else {
            // File level: files have no children
            return Promise.resolve([]);
        }
    }
    private async generatePullRequestItems(project: string, prItem: PullRequestItem): Promise<Map<string, FileItem>> {
        try {
            const commits = await this.pullRequestService.getPullRequestCommits(project, prItem.repoName, prItem.prId);
            const fileMap: Map<string, FileItem> = new Map(); // Store files by a unique key (file path + commitId) to prevent duplicates

            // Fetch commit changes in parallel using Promise.all
            const commitChangesPromises = commits.map(async (commit: any) => {
                const commitId = commit.commitId;
                return { commitId, changes: await this.pullRequestService.getCommitChanges(project, prItem.repoName, commitId) };
            });

            // Wait for all the commit changes to be fetched in parallel
            const allCommitChanges = await Promise.all(commitChangesPromises);

            // Flatten the array of commit changes and process the results
            allCommitChanges.flat().forEach(({ commitId, changes }) => {
                changes.forEach((change: any) => {
                    // Filter out folder changes and process only 'add', 'edit', or 'delete' changes
                    //if (!change.item.isFolder && (change.changeType === 'add' || change.changeType === 'edit' || change.changeType === 'delete')) {
                    if (!change.item.isFolder) {
                        // Generate a unique key by combining file path and commit ID to prevent duplicates
                        //const uniqueKey = `${change.item.path}-${commitId}`;
                        if (!fileMap.has(change.item.path)) {
                        //if (!fileMap.has(uniqueKey)) {
                            fileMap.set(
                                change.item.path,
                                new FileItem(
                                    change.item.path,
                                    change.item.path,
                                    change.changeType,
                                    change.item.url,
                                    change.item.originalObjectId,
                                    prItem.repoName,
                                    commitId, // Pass commitId to FileItem
                                    prItem.prId // Pass prId to FileItem,
                                )
                            );
                        }
                    }
                });
            });

            return fileMap;
        } catch (error) {
            this.handleError(error);
            return new Map<string, FileItem>();
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
            const repositories = await this.pullRequestService.getRepositories(azureDevOpsSelectedProject);

            // Step 2: Fetch pull requests for all repositories in parallel
            const repositoryItems = await Promise.all(repositories.map(async (repo: any) => {
                try {

                    const prResponse = await this.pullRequestService.getPullRequests(azureDevOpsSelectedProject, repo.id);
                    const pullRequests = prResponse.map((pr: any) => {
                        return new PullRequestItem(pr.title, pr.pullRequestId, repo.name, pr.description, pr.createdBy.displayName, pr.creationDate.split("T")[0], pr.sourceRefName);
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


    private buildFileTree(fileMap: Map<string, FileItem>): FolderItem[] {
        const rootFolders: FolderItem[] = []; // Root-level folders

        fileMap.forEach((fileItem, filePath) => {
            const parts = filePath.split('/').filter(Boolean); // Split path into folder parts and remove empty parts
            let currentChildren: FolderItem[] = rootFolders; // Start at the root level

            // Traverse through each folder in the path
            parts.slice(0, -1).forEach((folderName) => {
                let folder = currentChildren.find(item => item instanceof FolderItem && item.label === folderName) as FolderItem;

                if (!folder) {
                    folder = new FolderItem(folderName);
                    currentChildren.push(folder); // Add new folder to the current level
                }

                // Move into the folder for the next level
                // Since `FolderItem` has a `children` property, we can safely assign it here.
                currentChildren = folder.children as FolderItem[];
            });

            const fileName = parts[parts.length - 1]; // Get the file name from the path

            // Create a new FileItem with the fileName and full filePath
            const newFileItem = new FileItem(
                fileName,
                filePath,
                fileItem.changeType,
                fileItem.url,
                fileItem.originalObjectId,
                fileItem.repoName,
                fileItem.commitId,
                fileItem.pullRequestId // Added commitId
            );

            // Add the file to the last folder's children
            currentChildren.push(newFileItem as unknown as FolderItem); // Type assertion for this mixed array
        });

        return rootFolders;
    }





}

class RepositoryItem extends vscode.TreeItem {
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
class LoadingItem extends vscode.TreeItem {
    constructor() {
        super('Loading...', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('sync~spin'); // Shows the spinner icon
    }
}

class PullRequestItem extends vscode.TreeItem {
    constructor(
        public readonly prTitle: string,
        public readonly prId: number,
        public readonly repoName: string,
        private readonly prDescription: string,
        private readonly prCreatedBy: string,
        private readonly prcreationDate: string,
        private readonly prSourceBranch: string,
        public files: (FolderItem | FileItem)[] = [] // Add files and folders as children of the PR

    ) {
        super(prTitle, vscode.TreeItemCollapsibleState.Collapsed); // Collapsible to show files
        this.contextValue = 'pullRequestItem';
        this.tooltip = `Pull Request ID: ${this.prId}\nCreated by: ${this.prCreatedBy}\nCreation date: ${this.prcreationDate}\nSource Branch: ${this.prSourceBranch}\nDescription: ${this.prDescription ? prDescription : 'No description provided.'}\n`;
        this.iconPath = new vscode.ThemeIcon('git-pull-request');
    }
}

class FolderItem extends vscode.TreeItem {
    public children: (FolderItem | FileItem)[] = []; // Each folder can have other folders or files as children

    constructor(
        public readonly folderName: string
    ) {
        super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'folderItem';
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

class FileItem extends vscode.TreeItem {
    constructor(
        public readonly fileName: string,
        public readonly filePath: string,
        public readonly changeType: string,
        public readonly url: string,
        public readonly originalObjectId: string,
        public readonly repoName: string,
        public readonly commitId: string, // Add commitId property
        public readonly pullRequestId: number
    ) {
        super(fileName, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'fileItem';
        this.iconPath = this.getIconForChangeType(changeType);
        this.tooltip = `Filename: ${this.fileName}\nFile path: ${this.filePath}\nChange Type: ${this.changeType}\nCommit Id: ${this.commitId}\nPull Request Id: ${this.pullRequestId}`;
        this.command = {
            command: 'azureDevopsPullRequest.openFileContent',
            title: 'Open File',
            arguments: [fileName, url, originalObjectId, repoName, changeType]
        };
    }

    private getIconForChangeType(changeType: string): vscode.ThemeIcon {
        switch (changeType) {
            //case 'add': return 'diff-added';
            case 'add': return new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('charts.green'));
            //case 'edit': return 'diff-modified';
            case 'edit': return new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('charts.blue'));
            //case 'delete': return 'diff-removed';
            case 'delete': return new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('charts.red'));
            // default: return 'file';
            default: return new vscode.ThemeIcon('file');
        }
    }
}
