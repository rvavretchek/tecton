import { expect } from '@playwright/test';
import { test } from '@seontechnologies/playwright-utils/api-request/fixtures';

// Template for multi-service API tests. It needs a running Gateway, which arrives in
// Epic 3 (Story 3.6); until then it skips unless BASE_URL points to a running stack.
test.describe('@P1 @API gateway liveness', () => {
  test.skip(!process.env['BASE_URL'], 'Set BASE_URL to a running Tecton workspace (Gateway) to run API tests');

  test('Given a running gateway, When GET /live is called, Then it answers 200', async ({ apiRequest }) => {
    const { status } = await apiRequest({ method: 'GET', path: '/live' });

    expect(status).toBe(200);
  });
});
