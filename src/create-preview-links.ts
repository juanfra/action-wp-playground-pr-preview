import { debug } from '@actions/core';
import type { getOctokit } from '@actions/github';
import type { Context } from '@actions/github/lib/context';

interface ThemeZipFile {
	resource: string;
	url: string;
}

interface Step {
	step: string;
	username?: string;
	password?: string;
	themeZipFile?: ThemeZipFile;
	themeFolderName?: string;
}

interface Template {
	steps: Step[];
}

function createBlueprint(themeSlug: string, branch: string): string {
	debug(`Creating blueprint for themeSlug: ${themeSlug}, branch: ${branch}`);
	const template: Template = {
		steps: [
			{
				step: 'login',
				username: 'admin',
				password: 'password',
			},
			{
				step: 'installTheme',
				themeZipFile: {
					resource: 'url',
					url: `https://github-proxy.com/proxy.php?action=partial&repo=Automattic/themes&directory=${themeSlug}&branch=${branch}`,
				},
			},
			{
				step: 'activateTheme',
				themeFolderName: themeSlug,
			},
		],
	};

	const blueprint = JSON.stringify(template);
	debug(`Blueprint created: ${blueprint}`);
	return blueprint;
}

export default async function createPreviewLinksComment(
	github: ReturnType<typeof getOctokit>,
	context: Context,
	changedThemeSlugs: string,
): Promise<void> {
	debug('Starting createPreviewLinksComment');
	const pullRequest = context.payload?.pull_request;
	if (!pullRequest) {
		debug('No pull request found in context payload');
		throw new Error('No pull request found in context payload');
	}

	debug(`Pull request found: #${pullRequest.number}`);
	const changedThemes = changedThemeSlugs.split(',');
	debug(`Changed themes: ${changedThemes.join(', ')}`);

	const previewLinks = changedThemes
		.map((theme) => {
			const [themeName, themeDir] = theme.split(':');
			const themeSlug = themeDir.split('/')[0].trim();
			const parentThemeSlug = themeName.split('_childof_')[1];
			return `- [Preview changes for **${
				themeName.split('_childof_')[0]
			}**](https://playground.wordpress.net/#${createBlueprint(
				themeSlug,
				pullRequest.head.ref,
			)})${parentThemeSlug ? ` (child of **${parentThemeSlug}**)` : ''}`;
		})
		.join('\n');

	debug(`Preview links generated: ${previewLinks}`);

	const includesChildThemes = previewLinks.includes('child of');
	debug(`Includes child themes: ${includesChildThemes}`);

	const comment = `
I've detected changes to the following themes in this PR: ${changedThemes
		.map((changedTheme) => changedTheme.split(':')[0].split('_childof_')[0])
		.join(', ')}.

You can preview these changes by following the links below:

${previewLinks}

I will update this comment with the latest preview links as you push more changes to this PR.
**⚠️ Note:** The preview sites are created using [WordPress Playground](https://wordpress.org/playground/). You can add content, edit settings, and test the themes as you would on a real site, but please note that changes are not saved between sessions.
${
	includesChildThemes
		? '\n**⚠️ Note:** Child themes are dependent on their parent themes. You will have to install the parent theme as well for the preview to work correctly.'
		: ''
}`;

	const repoData = {
		owner: context.repo.owner,
		repo: context.repo.repo,
	};

	debug('Checking for existing comments');
	const { data: comments } = await github.rest.issues.listComments({
		issue_number: pullRequest.number,
		...repoData,
	});
	const existingComment = comments.find(
		(comment) =>
			comment.user?.login === 'github-actions[bot]' &&
			comment.body?.startsWith('### Preview changes'),
	);
	const commentObject = {
		body: `### Preview changes\n${comment}`,
		...repoData,
	};

	if (existingComment) {
		debug(`Updating existing comment: ${existingComment.id}`);
		await github.rest.issues.updateComment({
			comment_id: existingComment.id,
			...commentObject,
		});
		return;
	}

	debug('Creating new comment');
	await github.rest.issues.createComment({
		issue_number: pullRequest.number,
		...commentObject,
	});
}
