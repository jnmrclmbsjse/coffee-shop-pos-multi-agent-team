import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffMember } from '@coffee-shop/shared';
import { StaffPage } from './StaffPage';

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const mara: StaffMember = {
  id: 'b8931939-b6db-449e-b7d2-93f3521184ef',
  displayName: 'Mara Villanueva',
  isActive: true,
  locationId: null,
  hasAccount: false,
  accountUsername: null,
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
};

const amina: StaffMember = {
  ...mara,
  id: 'f19f35b4-470c-4c16-a50e-a97ddda388ec',
  displayName: 'Amina Santos',
  isActive: false,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <StaffPage />
    </MemoryRouter>,
  );
}

async function openAccountDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', {
    name: 'Create login account for Mara Villanueva',
  });
  await user.click(
    screen.getByRole('button', {
      name: 'Create login account for Mara Villanueva',
    }),
  );
  return screen.getByRole('dialog', { name: 'Create login account' });
}

async function fillRequiredAccountFields(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  await user.type(within(dialog).getByLabelText('Username'), 'mara.login');
  await user.type(within(dialog).getByLabelText('Password'), 'day shift');
}

describe('staff roster page', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('combines search, active filter, sort, and direction in one request', async () => {
    fetchMock.mockResolvedValue(response(200, [mara, amina]));
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('switch', {
      name: 'Deactivate Mara Villanueva',
    });
    await user.type(screen.getByLabelText('Search staff'), 'mAr');
    await user.selectOptions(screen.getByLabelText('Status'), 'false');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'active');
    await user.click(
      screen.getByRole('button', {
        name: /Sort direction: asc/,
      }),
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => {
          const parsed = new URL(String(url));
          return (
            parsed.pathname === '/staff' &&
            parsed.searchParams.get('search') === 'mAr' &&
            parsed.searchParams.get('active') === 'false' &&
            parsed.searchParams.get('sort') === 'active' &&
            parsed.searchParams.get('direction') === 'desc'
          );
        }),
      ).toBe(true);
    });
  });

  it('validates a required name and creates trimmed active staff by default', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        return response(201, {
          ...mara,
          displayName: 'Mara Villanueva',
        });
      }
      return response(200, []);
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('No staff members yet');
    await user.click(screen.getAllByRole('button', { name: 'Add staff' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Add staff' });
    expect(within(dialog).getByLabelText('Is active')).toHaveValue('true');

    await user.type(within(dialog).getByLabelText(/Name/), '   ');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add staff' }),
    );

    expect(
      screen.getByText(
        'Name is required. Enter at least one visible character.',
      ),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText(/Name/));
    await user.type(
      within(dialog).getByLabelText(/Name/),
      '  Mara Villanueva  ',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add staff' }),
    );

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          new URL(String(url)).pathname === '/staff' &&
          init?.method === 'POST',
      );
      expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
        displayName: 'Mara Villanueva',
        isActive: true,
      });
    });
  });

  it('cancels edits without changing the roster or calling the API', async () => {
    fetchMock.mockResolvedValue(response(200, [mara]));
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('switch', {
      name: 'Deactivate Mara Villanueva',
    });
    await user.click(
      screen.getByRole('button', { name: 'Edit Mara Villanueva' }),
    );
    await user.clear(screen.getByLabelText(/Name/));
    await user.type(screen.getByLabelText(/Name/), 'Changed name');
    await user.selectOptions(screen.getByLabelText('Is active'), 'false');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByRole('dialog', { name: 'Edit staff' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('Mara Villanueva')).not.toHaveLength(0);
    expect(screen.queryByText('Changed name')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH'),
    ).toHaveLength(0);
  });

  it('deactivates inline without deleting the staff member', async () => {
    const inactiveMara = {
      ...mara,
      isActive: false,
      updatedAt: '2026-07-25T01:00:00.000Z',
    };
    let listResponse = [mara];
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH') {
        listResponse = [inactiveMara];
        return response(200, inactiveMara);
      }
      return response(200, listResponse);
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('switch', {
      name: 'Deactivate Mara Villanueva',
    });
    await user.click(
      screen.getByRole('switch', { name: 'Deactivate Mara Villanueva' }),
    );

    expect(await screen.findByText('Mara Villanueva is now inactive.')).toBeInTheDocument();
    expect(screen.getAllByText('Mara Villanueva')).not.toHaveLength(0);
    expect(
      screen.getByText('Inactive', { selector: '.state-badge' }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE'),
    ).toBe(false);
    const updateCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH',
    );
    expect(JSON.parse(String(updateCall?.[1]?.body))).toEqual({
      isActive: false,
    });
  });

  it('shows a no-results state that can clear the current criteria', async () => {
    fetchMock.mockResolvedValue(response(200, []));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('No staff members yet');
    await user.type(screen.getByLabelText('Search staff'), 'missing');

    expect(
      await screen.findByText('No staff match your search or filter'),
    ).toBeInTheDocument();
    await user.click(
      screen.getAllByRole('button', {
        name: 'Clear search and filter',
      })[0]!,
    );
    expect(screen.getByLabelText('Search staff')).toHaveValue('');
    expect(screen.getByLabelText('Status')).toHaveValue('all');
  });

  it('offers account creation for active members and explains why it is unavailable for inactive members', async () => {
    fetchMock.mockResolvedValue(response(200, [mara, amina]));
    renderPage();

    expect(
      await screen.findByRole('button', {
        name: 'Create login account for Mara Villanueva',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Create login account for Amina Santos',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Activate staff to create an account'),
    ).toBeInTheDocument();
  });

  it('offers credential replacement, shows the username, and reconciles the row without reloading', async () => {
    const linked: StaffMember = {
      ...mara,
      isActive: false,
      hasAccount: true,
      accountUsername: 'mara.login',
    };
    fetchMock.mockImplementation(async (url, init) => {
      if (
        new URL(String(url)).pathname ===
          `/staff/${linked.id}/account/credentials` &&
        init?.method === 'PATCH'
      ) {
        return response(200, {
          staffMember: {
            ...linked,
            updatedAt: '2026-08-23T16:00:00.000Z',
          },
          passwordChanged: true,
          pinChanged: false,
          pinSet: true,
        });
      }
      return response(200, [linked]);
    });
    const user = userEvent.setup();
    renderPage();

    const replace = await screen.findByRole('button', {
      name: 'Replace password or PIN for Mara Villanueva',
    });
    expect(
      screen.queryByRole('button', {
        name: 'Create login account for Mara Villanueva',
      }),
    ).not.toBeInTheDocument();

    expect(screen.getByText('mara.login')).toBeInTheDocument();
    await user.click(replace);

    const dialog = screen.getByRole('dialog', {
      name: 'Replace password or PIN',
    });
    expect(within(dialog).getByText('mara.login')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('New password'), 'new pass');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save credential changes' }),
    );
    expect(await within(dialog).findByText('Password replaced')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          new URL(String(url)).pathname === '/staff' &&
          (!init?.method || init.method === 'GET'),
      ),
    ).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(
      await screen.findByText("Mara Villanueva's login credentials were updated."),
    ).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveFocus());
  });

  it('clears credential drafts on cancel before the dialog is reopened', async () => {
    const linked: StaffMember = {
      ...mara,
      hasAccount: true,
      accountUsername: 'mara.login',
    };
    fetchMock.mockResolvedValue(response(200, [linked]));
    const user = userEvent.setup();
    renderPage();

    const replace = await screen.findByRole('button', {
      name: 'Replace password or PIN for Mara Villanueva',
    });
    await user.click(replace);
    await user.type(screen.getByLabelText('New password'), 'temporary secret');
    await user.type(screen.getByLabelText('New PIN'), '2048');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByRole('dialog', { name: 'Replace password or PIN' }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveFocus());
    await user.click(replace);
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('New PIN')).toHaveValue('');
  });

  it('creates an account once with a normalized payload and never echoes credentials after success', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (
        new URL(String(url)).pathname === `/staff/${mara.id}/account` &&
        init?.method === 'POST'
      ) {
        return response(201, {
          username: 'mara.login',
          displayName: 'Mara Register',
        });
      }
      return response(200, [mara]);
    });
    const user = userEvent.setup();
    renderPage();
    const dialog = await openAccountDialog(user);

    await user.type(within(dialog).getByLabelText('Username'), '  Mara.Login  ');
    await user.clear(within(dialog).getByLabelText('Display name'));
    await user.type(
      within(dialog).getByLabelText('Display name'),
      '  Mara Register  ',
    );
    await user.type(
      within(dialog).getByLabelText('Password'),
      ' day shift ',
    );
    await user.type(within(dialog).getByLabelText('PIN'), '2048');
    await user.click(
      within(dialog).getByRole('button', { name: 'Create account' }),
    );

    expect(
      await within(dialog).findByText('Login account created'),
    ).toBeInTheDocument();
    const createCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        new URL(String(url)).pathname === `/staff/${mara.id}/account` &&
        init?.method === 'POST',
    );
    expect(createCalls).toHaveLength(1);
    expect(JSON.parse(String(createCalls[0]?.[1]?.body))).toEqual({
      username: 'mara.login',
      displayName: 'Mara Register',
      password: ' day shift ',
      pin: '2048',
    });
    expect(dialog).not.toHaveTextContent(' day shift ');
    expect(dialog).not.toHaveTextContent('2048');
    expect(within(dialog).queryByLabelText('Password')).not.toBeInTheDocument();
    expect(within(dialog).getByText('The password and PIN are not shown.'))
      .toBeInTheDocument();
  });

  it('attributes server 400 validation messages to their fields', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === 'POST' && String(url).includes('/account')) {
        return response(400, {
          message: [
            'username must not be blank',
            'password must not be empty',
            'pin must be exactly 4 digits',
          ],
        });
      }
      return response(200, [mara]);
    });
    const user = userEvent.setup();
    renderPage();
    const dialog = await openAccountDialog(user);
    await fillRequiredAccountFields(user, dialog);
    await user.type(within(dialog).getByLabelText('PIN'), '2048');
    await user.click(
      within(dialog).getByRole('button', { name: 'Create account' }),
    );

    expect(await within(dialog).findByText('Review the fields below.'))
      .toBeInTheDocument();
    expect(within(dialog).getByLabelText('Username')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(dialog).getByLabelText('Password')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(dialog).getByLabelText('PIN')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(dialog).getAllByText('Enter a username.')).toHaveLength(2);
    expect(within(dialog).getAllByText('Enter a password.')).toHaveLength(2);
    expect(
      within(dialog).getAllByText(
        'Enter exactly 4 digits, or leave the PIN blank.',
      ),
    ).toHaveLength(2);
  });

  it('keeps the populated form open and attributes a username conflict', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === 'POST' && String(url).includes('/account')) {
        return response(409, {
          message: 'This username is already in use',
          field: 'username',
          reason: 'USERNAME_TAKEN',
        });
      }
      return response(200, [mara]);
    });
    const user = userEvent.setup();
    renderPage();
    const dialog = await openAccountDialog(user);
    await fillRequiredAccountFields(user, dialog);
    await user.type(within(dialog).getByLabelText('PIN'), '2048');
    await user.click(
      within(dialog).getByRole('button', { name: 'Create account' }),
    );

    expect(
      await within(dialog).findAllByText(
        'That username is already in use. Usernames ignore uppercase letters and spaces at the beginning or end.',
      ),
    ).toHaveLength(2);
    expect(within(dialog).getByLabelText('Username')).toHaveValue('mara.login');
    expect(within(dialog).getByLabelText('Display name')).toHaveValue(
      'Mara Villanueva',
    );
    expect(within(dialog).getByLabelText('Password')).toHaveValue('day shift');
    expect(within(dialog).getByLabelText('PIN')).toHaveValue('2048');
    expect(within(dialog).getByLabelText('Username')).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('staff-account-username-error'),
    );
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Username')).toHaveFocus();
    });
  });

  it.each([
    [
      'STAFF_MEMBER_ALREADY_HAS_ACCOUNT',
      'This staff member already has a login account',
      'This staff member already has a login account. Nothing was created or changed.',
    ],
    [
      'STAFF_MEMBER_INACTIVE',
      'A login account cannot be created for an inactive staff member',
      'This staff member is inactive. Activate the staff member before creating an account. Nothing was created or changed.',
    ],
  ])(
    'shows the %s refusal at dialog level',
    async (reason, message, expected) => {
      fetchMock.mockImplementation(async (url, init) => {
        if (init?.method === 'POST' && String(url).includes('/account')) {
          return response(409, { message, reason });
        }
        return response(200, [mara]);
      });
      const user = userEvent.setup();
      renderPage();
      const dialog = await openAccountDialog(user);
      await fillRequiredAccountFields(user, dialog);
      await user.click(
        within(dialog).getByRole('button', { name: 'Create account' }),
      );

      expect(await within(dialog).findByText('No account was created.'))
        .toBeInTheDocument();
      expect(within(dialog).getByText(expected)).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Username')).toHaveValue(
        'mara.login',
      );
      expect(within(dialog).getByLabelText('Password')).toHaveValue(
        'day shift',
      );
    },
  );
});
