import {test, expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {clarificationFixture, responseFixture} from '../src/test/fixtures';

test('welcome desk fits the viewport and exposes investing context', async ({page}, testInfo) => {
    await page.goto('/');
    await expect(page).toHaveTitle('JunieVest — The Research Desk');
    await expect(page.getByRole('heading', {name: /Don’t just follow/})).toBeVisible();
    await expect(page.getByRole('textbox', {name: 'Your investment question'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Quick take', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', {name: /Don’t just follow/})).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.AIR_ARTIFACTS_DIR) {
        await mkdir(process.env.AIR_ARTIFACTS_DIR, {recursive: true});
        await page.screenshot({path: join(process.env.AIR_ARTIFACTS_DIR, `junievest-${testInfo.project.name}.png`)});
    }
    if (testInfo.project.name === 'mobile') await page.getByText('Your investing context').click();
    await page.getByLabel('Capital to deploy').fill('$10,000');
    await expect(page.getByLabel('Capital to deploy')).toHaveValue('$10,000');
});

test('clarification becomes a sourced decision and a contextual follow-up', async ({page}, testInfo) => {
    const requests: {messages: {role: string; content: string}[]}[] = [];
    await page.route('**/api/health', route => route.fulfill({json: {configured: true}}));
    await page.route('**/api/chat', async route => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({json: requests.length === 1 ? clarificationFixture : responseFixture});
    });
    await page.goto('/');
    await page.getByRole('textbox', {name: 'Your investment question'}).fill('Help me invest.');
    await page.getByRole('button', {name: 'Send message'}).click();
    await expect(page.getByRole('region', {name: 'Clarifying questions'})).toBeVisible();
    await page.getByRole('button', {name: 'More than 5 years', exact: true}).click();
    await page.getByRole('textbox', {name: 'Where are you investing from?'}).fill('Canada');
    await page.getByRole('button', {name: /Build my brief/}).click();
    await expect(page.getByText('NO / THE CALL')).toBeVisible();
    expect(requests[1].messages).toHaveLength(3);
    expect(requests[1].messages[2].content).toContain('Canada');
    const sources = page.locator('.sources-panel summary');
    await sources.click();
    await expect(page.getByText('Publication date unavailable', {exact: false})).toBeVisible();
    await expect(page.getByRole('link', {name: '[1] Illustrative fund disclosure', exact: true})).toHaveAttribute('href', 'https://example.com/disclosure');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.AIR_ARTIFACTS_DIR && testInfo.project.name === 'desktop') {
        await page.setViewportSize({width: 1440, height: 1600});
        await page.getByRole('article', {name: 'Investment brief'}).screenshot({path: join(process.env.AIR_ARTIFACTS_DIR, 'junievest-synthetic-brief.png')});
    }
    await page.getByRole('button', {name: /What would a better entry look like/}).click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2].messages).toHaveLength(5);
});

test('research failures are retryable without duplicated questions', async ({page}) => {
    let count = 0;
    const modes: string[] = [];
    await page.route('**/api/chat', route => {
        count++;
        modes.push(route.request().postDataJSON().mode);
        return route.fulfill(count === 1
            ? {status: 502, json: {error: 'Current research is unavailable. No investment call was made. Please retry.'}}
            : {json: responseFixture});
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Deep research', exact: true}).click();
    await page.getByRole('button', {name: /Should I invest in SpaceX today/}).click();
    await expect(page.getByRole('alert')).toContainText('No investment call was made.');
    await page.getByRole('button', {name: 'Quick take', exact: true}).click();
    await page.getByRole('button', {name: /Retry brief/}).click();
    await expect(page.getByText('NO / THE CALL')).toBeVisible();
    await expect(page.getByText('Should I invest in SpaceX today?', {exact: true})).toHaveCount(1);
    expect(modes).toEqual(['deep', 'deep']);
});
