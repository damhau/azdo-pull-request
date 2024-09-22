
# Azure DevOps Pull Request Review VS Code Extension

## Overview

The Azure DevOps Pull Request Review extension for Visual Studio Code enables users to manage their Azure DevOps pull requests directly from the IDE. This extension provides features for listing, approving, rejecting, commenting on, and creating new pull requests, all from within the VS Code interface.

## Features

- **List Pull Requests:** View all pull requests across repositories within a specified Azure DevOps project.
- **Approve Pull Request:** Approve pull requests directly from the VS Code interface.
- **Reject Pull Request:** Reject pull requests with a single command.
- **Create New Pull Request:** Create new pull requests by selecting the repository and source branch.
- **Abandon Pull Request:** Mark pull requests as abandoned.
- **Open Pull Request in Browser:** Quickly navigate to the pull request in your default browser.
- **Add Comment to Pull Request:** Add comments to pull requests using a custom webview.

## Installation

1. Download and install [Visual Studio Code](https://code.visualstudio.com/).
2. Open VS Code and go to the Extensions view by clicking on the Extensions icon in the Activity Bar on the side of the window.
3. Search for "Azure DevOps Pull Request Review" and install the extension.

## Configuration

During the first startup the extension will prompt you to enter the needed configutaiton but if you want to change it you can follow this procedure.

Before using the extension, you need to configure it with your Azure DevOps details:

1. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P).
2. Run the command `Azure DevOps Pull Request: Configure`.
3. Enter the following details:
   - **Organization URL:** The URL of your Azure DevOps organization (e.g., `https://dev.azure.com/your-organization`).
   - **Project Name:** The name of your Azure DevOps project.
   - **Personal Access Token (PAT):** A personal access token with sufficient permissions to access pull requests.

The extension will store your PAT securely using VS Code's Secret Storage.

## Usage

### List Pull Requests

1. Click on the Azure DevOps Pull Request view in the Activity Bar.
2. The extension will display all pull requests for each repository in your configured Azure DevOps project.

### Approve or Reject Pull Request

1. Select a pull request and click on the check or cross button to approve of reject
2. The extension will add you as a reviewer and register your vote accordingly.

### Create New Pull Request

1. Click on the add button in the Azure DevOps Pull Request view.
2. Follow the prompts to select the repository, source branch, and provide a title and description.

### Add Comment to Pull Request

1. Select a pull request and click on the comment icon.
2. A webview will open, displaying existing comments.
3. Enter your comment and click `Submit`.

### Open Pull Request in Browser

1. Select a pull request and click on the open in browser icon.
2. This will open the pull request in your default web browser

### Refresh Pull Requests

1. Click on the refresh button in the Azure DevOps Pull Request view to reload the list of pull requests.

## Commands

The extension provides the following commands:

- `azureDevopsPullRequest.listPullRequests`: List all pull requests for the configured Azure DevOps project.
- `azureDevopsPullRequest.approvePullRequest`: Approve a selected pull request.
- `azureDevopsPullRequest.rejectPullRequest`: Reject a selected pull request.
- `azureDevopsPullRequest.createPullRequest`: Open the form to create a new pull request.
- `azureDevopsPullRequest.refreshPullRequests`: Refresh the list of pull requests.
- `azureDevopsPullRequest.abandonPullRequest`: Mark a selected pull request as abandoned.
- `azureDevopsPullRequest.openPullRequestInBrowser`: Open a selected pull request in the default web browser.
- `azureDevopsPullRequest.addCommentToPullRequest`: Add a comment to a selected pull request.

## Configuration Options

You can configure the following settings in your VS Code `settings.json`:

- `azureDevopsPullRequest.azureDevOpsOrgUrl`: The URL of your Azure DevOps organization.
- `azureDevopsPullRequest.azureDevOpsProject`: The name of your Azure DevOps project.
- `azureDevopsPullRequest.personalAccessToken`: Your Azure DevOps personal access token.
- `azureDevopsPullRequest.userAgent`: Custom user agent for the HTTP requests made to Azure DevOps.

## Troubleshooting

- Ensure that your Personal Access Token has the necessary permissions to access pull requests and repositories.
- Verify that the organization URL and project name are correctly configured.
- If you encounter issues, try reloading the window (`Ctrl+Shift+P` > `Reload Window`).

## Contributing

If you would like to contribute to the extension, please follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Submit a pull request with a clear description of your changes.

## License

This project is licensed under the MIT License. See the `LICENSE` file for more details.

## Acknowledgements

- [Visual Studio Code API](https://code.visualstudio.com/api) for providing the development framework.
- [Azure DevOps REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops) for enabling integration with Azure DevOps.

## Contact

For questions or suggestions, please open an issue on the [GitHub repository](https://github.com/your-repo/azure-devops-review-pull-request).
