import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@coffee-shop/shared';
import { AppRoutes, safeReturnPath } from './App';
import { readRememberedStaff, rememberStaff } from './auth/device';

const adminUser = {
  id: 'admin-id',
  username: 'studio.admin',
  role: Role.ADMIN,
};

const staffUser = {
  id: '8ce77958-342f-4c1a-a8dd-bc3fcd71a96a',
  username: 'maya.santos',
  displayName: 'Maya Santos',
  role: Role.STAFF,
} as const;

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
    window.localStorage.clear();
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

  it('groups admin destinations, distinguishes their icons, and marks the current page', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { user: adminUser }));

    renderAt('/reports');

    await screen.findByRole('heading', { name: 'Reports' });
    const navigation = screen.getByRole('navigation', {
      name: 'Administrator navigation',
    });

    expect(
      within(navigation).getByRole('group', { name: 'Workspace' }),
    ).toBeInTheDocument();
    expect(
      within(navigation).getByRole('group', { name: 'Catalog' }),
    ).toBeInTheDocument();
    expect(
      within(navigation).getByRole('group', { name: 'Operations' }),
    ).toBeInTheDocument();
    expect(
      within(navigation).getAllByRole('link').map((link) => link.textContent),
    ).toEqual([
      'Dashboard',
      'Categories',
      'Products',
      'Inventory',
      'Staff',
      'Reports',
      'Order History',
    ]);
    expect(
      [...navigation.querySelectorAll<SVGElement>('svg[data-icon]')].map(
        (icon) => icon.dataset.icon,
      ),
    ).toEqual([
      'bars',
      'folder',
      'box',
      'clipboard',
      'users',
      'document',
      'receipt',
    ]);
    expect(within(navigation).getByRole('link', { name: 'Reports' }))
      .toHaveAttribute('aria-current', 'page');
  });
});

describe('staff authentication routes', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses staff password login, remembers the staff identity, and opens the POS', async () => {
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { user: staffUser }));
    const user = userEvent.setup();

    renderAt('/staff/sign-in');

    expect(
      await screen.findByRole('heading', {
        name: 'No staff remembered on this device',
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Use Username and Password' }),
    );
    await user.type(screen.getByLabelText('Username'), ' maya.santos ');
    await user.type(screen.getByLabelText('Password'), 'correct password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Ready for the next order.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Signed in as Maya Santos')).toBeInTheDocument();
    expect(readRememberedStaff()).toEqual([
      { id: staffUser.id, displayName: staffUser.displayName },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/auth/staff/login',
      expect.objectContaining({
        credentials: 'include',
        body: expect.stringContaining('"deviceId"'),
      }),
    );
    const loginCall = fetchMock.mock.calls.find(
      ([url]) => url === 'http://localhost:3000/auth/staff/login',
    );
    expect(
      JSON.parse(
        String(
          (loginCall?.[1] as RequestInit | undefined)?.body,
        ),
      ),
    ).toMatchObject({
      username: ' maya.santos ',
      password: 'correct password',
    });
  });

  it('supports correction and clear controls before a four-digit PIN submit', async () => {
    rememberStaff(staffUser);
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { user: staffUser }));
    const user = userEvent.setup();

    renderAt('/staff/sign-in');

    await user.click(await screen.findByRole('button', { name: /Maya Santos/ }));
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('2 of 4 PIN digits entered.')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Correct last PIN digit' }),
    );
    expect(screen.getByText('1 of 4 PIN digits entered.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('0 of 4 PIN digits entered.')).toBeInTheDocument();

    for (const digit of ['1', '2', '3', '4']) {
      await user.click(screen.getByRole('button', { name: digit }));
    }
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(
      await screen.findByRole('heading', { name: 'Ready for the next order.' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/auth/staff/pin',
      expect.objectContaining({
        body: expect.stringContaining(`"staffId":"${staffUser.id}"`),
      }),
    );
  });

  it('shows one generic error and clears a refused PIN', async () => {
    rememberStaff(staffUser);
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(
        response(401, { message: 'Invalid staff credentials.' }),
      );
    const user = userEvent.setup();

    renderAt('/staff/sign-in');

    await user.click(await screen.findByRole('button', { name: /Maya Santos/ }));
    for (const digit of ['9', '9', '9', '9']) {
      await user.click(screen.getByRole('button', { name: digit }));
    }
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not sign you in. Check your details and try again.',
    );
    expect(screen.getByText('0 of 4 PIN digits entered.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('shows the server retry time and locks further attempts while throttled', async () => {
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(
        response(429, {
          message: 'Too many failed attempts. Try again in 30 seconds.',
          retryAfterSeconds: 30,
        }),
      );
    const user = userEvent.setup();

    renderAt('/staff/sign-in');

    await user.click(
      await screen.findByRole('button', {
        name: 'Use Username and Password',
      }),
    );
    await user.type(screen.getByLabelText('Username'), 'maya.santos');
    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many failed attempts. Try again in 30 seconds.',
    );
    expect(screen.getByLabelText('Username')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('does not render administrator pages for an authenticated staff session', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { user: staffUser }));

    renderAt('/reports');

    expect(
      await screen.findByRole('heading', { name: 'Ready for the next order.' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Reports' }),
    ).not.toBeInTheDocument();
  });

  it('opens inventory routes under the staff guard with persistent active navigation', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/auth/session') {
        return response(200, { user: staffUser });
      }
      if (path === '/inventory/counts/opening-sheet') {
        return response(200, {
          businessDay: {
            isOpen: true,
            businessDate: '2026-07-30',
            dayType: 'NORMAL',
          },
          phase: 'open',
          items: [],
          submittedCount: null,
        });
      }
      if (path === '/trading-day/current') {
        return response(200, {
          isOpen: true,
          businessDate: '2026-07-30',
          dayType: 'NORMAL',
          openingFloatCents: 50000,
          openedByDisplayName: 'Maya Santos',
          openedAt: '2026-07-30T07:00:00.000Z',
        });
      }
      if (path === '/inventory/counts/staff') {
        return response(200, []);
      }
      return response(500);
    });

    renderAt('/pos/opening');

    expect(
      await screen.findByRole('heading', { name: 'Opening count' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Opening' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('link', { name: 'Deliveries & Wastage' }),
    ).toHaveAttribute('href', '/pos/movements');
    expect(screen.getByRole('link', { name: 'Order History' })).toHaveAttribute(
      'href',
      '/pos/orders',
    );
    expect(screen.getByRole('link', { name: 'Cash & Expenses' })).toHaveAttribute(
      'href',
      '/pos/cash',
    );
    expect(screen.getByRole('link', { name: 'Open Day' })).toHaveAttribute(
      'href',
      '/pos/open',
    );
    expect(screen.getByRole('link', { name: 'Close Day' })).toHaveAttribute(
      'href',
      '/pos/close',
    );
    expect(screen.queryByText(/cashier/i)).not.toBeInTheDocument();

    const navigation = screen.getByRole('navigation', {
      name: 'Staff workspace',
    });
    expect(
      within(navigation).getAllByRole('link').map((item) => item.textContent),
    ).toEqual([
      'Sell',
      'Open Day',
      'Opening',
      'Restock',
      'Deliveries & Wastage',
      'Order History',
      'Cash & Expenses',
      'Closing',
      'Close Day',
    ]);
    expect(screen.getByLabelText('Business day context')).toHaveTextContent(
      'Jul 30, 2026Normal day',
    );
  });

  it('keeps unmet destinations visible and non-actionable when no day is open', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/auth/session') {
        return response(200, { user: staffUser });
      }
      if (path === '/trading-day/current') {
        return response(200, {
          isOpen: false,
          businessDate: null,
          dayType: null,
          openingFloatCents: null,
          openedByDisplayName: null,
          openedAt: null,
        });
      }
      return response(500);
    });

    renderAt('/pos');

    await screen.findByText('No business day open');
    expect(screen.getByRole('link', { name: 'Sell' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Open Day' })).toHaveAttribute(
      'href',
      '/pos/open',
    );
    expect(screen.getByRole('link', { name: 'Order History' })).toHaveAttribute(
      'href',
      '/pos/orders',
    );

    const unavailable = screen.getByRole('link', {
      name: 'Opening, unavailable until a business day is open',
    });
    expect(unavailable).toHaveAttribute('aria-disabled', 'true');
    expect(unavailable).not.toHaveAttribute('href');
    expect(unavailable).not.toHaveAttribute('tabindex');
  });

  it('opens staff order history under the staff guard and marks its navigation current', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/auth/session') {
        return response(200, { user: staffUser });
      }
      if (path === '/trading-day') {
        return response(200, {
          items: [
            {
              id: 'day-open',
              businessDate: '2026-07-31',
              status: 'OPEN',
            },
          ],
          currentOpenBusinessDayId: 'day-open',
        });
      }
      if (path === '/reporting/staff-order-ledger/day-open') {
        return response(200, { businessDayId: 'day-open', orders: [] });
      }
      return response(500);
    });

    renderAt('/pos/orders');

    expect(
      await screen.findByRole('heading', { name: 'Order History' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Order History' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByText('No orders to show')).toBeInTheDocument();
  });

  it('keeps the cash and expenses route inside the staff guard', async () => {
    fetchMock.mockResolvedValueOnce(response(401));

    renderAt('/pos/cash');

    expect(
      await screen.findByRole('heading', {
        name: 'No staff remembered on this device',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Cash & Expenses' }),
    ).not.toBeInTheDocument();
  });

  it('opens cash and expenses for staff and marks its navigation current', async () => {
    fetchMock.mockImplementation(async (url) => {
      const requestPath = new URL(String(url)).pathname;
      if (requestPath === '/auth/session') {
        return response(200, { user: staffUser });
      }
      if (requestPath === '/trading-day/current') {
        return response(200, {
          isOpen: true,
          businessDate: '2026-07-31',
          dayType: 'NORMAL',
          openingFloatCents: 50000,
          openedByDisplayName: 'Maya Santos',
          openedAt: '2026-07-31T00:00:00.000Z',
        });
      }
      if (requestPath === '/trading-day/current/cash-movements') {
        return response(200, {
          businessDay: {
            isOpen: true,
            businessDate: '2026-07-31',
            dayType: 'NORMAL',
            openingFloatCents: 50000,
            openedByDisplayName: 'Maya Santos',
            openedAt: '2026-07-31T00:00:00.000Z',
          },
          movements: [],
        });
      }
      if (requestPath === '/inventory/counts/staff') return response(200, []);
      return response(500);
    });

    renderAt('/pos/cash');

    expect(
      await screen.findByRole('heading', { name: 'Cash & Expenses' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: 'Cash & Expenses' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    {
      path: '/pos/open',
      endpoint: '/trading-day/current',
      heading: 'Open business day',
      activeLink: 'Open Day',
      body: {
        isOpen: true,
        businessDate: '2026-07-30',
        dayType: 'NORMAL',
        openingFloatCents: 50000,
        openedByDisplayName: 'Maya Santos',
        openedAt: '2026-07-30T07:00:00.000Z',
      },
    },
    {
      path: '/pos/close',
      endpoint: '/trading-day/current/closing-summary',
      heading: 'Close business day',
      activeLink: 'Close Day',
      body: {
        isOpen: false,
        businessDate: null,
        openingFloatCents: null,
        cashSalesCents: null,
        onlineSalesCents: null,
        grossSalesCents: null,
        cashTipsCents: null,
        cashInCents: null,
        cashOutCents: null,
        cashExpensesCents: null,
        outstandingChangeCents: null,
        expectedCashCents: null,
        packaging: [],
        hasClosingStockCount: false,
      },
    },
  ])(
    'opens $path under the staff guard and marks $activeLink current',
    async ({ path: routePath, endpoint, heading, activeLink, body }) => {
      fetchMock.mockImplementation(async (url) => {
        const requestPath = new URL(String(url)).pathname;
        if (requestPath === '/auth/session') {
          return response(200, { user: staffUser });
        }
        if (requestPath === endpoint) return response(200, body);
        return response(500);
      });

      renderAt(routePath);

      expect(
        await screen.findByRole('heading', { name: heading }),
      ).toBeInTheDocument();
      const currentDestination = await screen.findByRole('link', {
        name: new RegExp(`^${activeLink}`),
      });
      expect(currentDestination).toHaveAttribute(
        'aria-current',
        'page',
      );
    },
  );
});

describe('remembered staff storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps the latest display name without duplicating an identity', () => {
    rememberStaff(staffUser);
    rememberStaff({ ...staffUser, displayName: 'Maya S.' });

    expect(readRememberedStaff()).toEqual([
      { id: staffUser.id, displayName: 'Maya S.' },
    ]);
  });

  it('ignores malformed browser storage', () => {
    window.localStorage.setItem(
      'ucm.staff-auth.remembered-staff.v1',
      '{not-json',
    );

    expect(readRememberedStaff()).toEqual([]);
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
