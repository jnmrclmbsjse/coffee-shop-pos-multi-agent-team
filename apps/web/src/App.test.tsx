import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@coffee-shop/shared';
import { AppRoutes, safeReturnPath } from './App';

const adminUser = {
  id: 'admin-id',
  username: 'studio.admin',
  role: Role.ADMIN,
};

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('administrator authentication routes', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gates a direct protected URL before rendering protected content', async () => {
    fetchMock.mockResolvedValueOnce(response(401));

    renderAt('/reports?period=today');

    expect(
      screen.getByText('Checking administrator access…'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Reports' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Sign in to continue to', { exact: false }),
    ).toHaveTextContent('Sign in to continue to Reports.');
  });

  it('shows required-field errors without sending a login request', async () => {
    fetchMock.mockResolvedValueOnce(response(401));
    const user = userEvent.setup();

    renderAt('/sign-in');

    await screen.findByRole('heading', { name: 'Sign in' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Username is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the generic error for refused credentials and preserves password spaces', async () => {
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(
        response(401, { message: 'Invalid username or password.' }),
      );
    const user = userEvent.setup();

    renderAt('/sign-in');

    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(screen.getByLabelText('Username'), 'unknown');
    await user.type(screen.getByLabelText('Password'), ' exact password ');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid username or password.',
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:3000/auth/login',
      expect.objectContaining({
        credentials: 'include',
        body: JSON.stringify({
          username: 'unknown',
          password: ' exact password ',
        }),
      }),
    );
  });

  it('returns to the full intended path after a successful sign-in', async () => {
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { user: adminUser }));
    const user = userEvent.setup();

    renderAt('/inventory?mode=closing');

    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(screen.getByLabelText('Username'), ' studio.admin ');
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Inventory' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Signed in as studio.admin')).toBeInTheDocument();
  });

  it('restores an authenticated session before showing a protected route', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { user: adminUser }));

    renderAt('/reports');

    expect(
      screen.queryByRole('heading', { name: 'Reports' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Reports' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Sign in' }),
    ).not.toBeInTheDocument();
  });
});

describe('safeReturnPath', () => {
  it.each([
    null,
    '',
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/sign-in',
  ])(
    'falls back to the dashboard for unsafe destination %s',
    (destination) => {
      expect(safeReturnPath(destination)).toBe('/dashboard');
    },
  );

  it('preserves a safe local path and query string', () => {
    expect(safeReturnPath('/inventory?mode=closing')).toBe(
      '/inventory?mode=closing',
    );
  });
});
