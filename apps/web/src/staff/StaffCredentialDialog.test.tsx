import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffMember } from '@coffee-shop/shared';
import { StaffCredentialDialog } from './StaffCredentialDialog';

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const member: StaffMember = {
  id: 'b8931939-b6db-449e-b7d2-93f3521184ef',
  displayName: 'Mara Villanueva',
  isActive: true,
  locationId: null,
  hasAccount: true,
  accountUsername: 'mara.login',
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
};

const PIN_ERROR = 'Enter exactly four digits using 0 to 9 only.';

function success(passwordChanged: boolean, pinChanged: boolean) {
  return {
    staffMember: {
      ...member,
      updatedAt: '2026-08-23T16:00:00.000Z',
    },
    passwordChanged,
    pinChanged,
    pinSet: true,
  };
}

function renderDialog() {
  const onClose = vi.fn();
  const onUpdated = vi.fn();
  const rendered = render(
    <StaffCredentialDialog
      member={member}
      onClose={onClose}
      onUpdated={onUpdated}
    />,
  );
  return { ...rendered, onClose, onUpdated };
}

function credentialRequest(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.find(
    ([url, init]) =>
      new URL(String(url)).pathname ===
        `/staff/${member.id}/account/credentials` && init?.method === 'PATCH',
  );
}

describe('StaffCredentialDialog', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('updates only the password, preserves spaces, and clears concealed values after success', async () => {
    fetchMock.mockResolvedValue(response(200, success(true, false)));
    const user = userEvent.setup();
    const { onUpdated } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Replace password or PIN' });
    const password = within(dialog).getByLabelText('New password');
    const pin = within(dialog).getByLabelText('New PIN');

    expect(password).toHaveAttribute('type', 'password');
    expect(pin).toHaveAttribute('type', 'password');
    expect(within(dialog).getByText('mara.login')).toBeInTheDocument();
    await user.type(password, ' exact password ');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save credential changes' }),
    );

    expect(
      await within(dialog).findByRole('heading', { name: 'Password replaced' }),
    ).toBeInTheDocument();
    expect(JSON.parse(String(credentialRequest(fetchMock)?.[1]?.body))).toEqual({
      password: ' exact password ',
    });
    expect(onUpdated).toHaveBeenCalledWith(success(true, false).staffMember);
    expect(within(dialog).queryByLabelText('New password')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('New PIN')).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(' exact password ');
    expect(dialog).toHaveTextContent('Sessions already signed in were not ended');
  });

  it('updates only the PIN and omits the blank password', async () => {
    fetchMock.mockResolvedValue(response(200, success(false, true)));
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Replace password or PIN' });

    await user.type(within(dialog).getByLabelText('New PIN'), '2048');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save credential changes' }),
    );

    expect(
      await within(dialog).findByRole('heading', { name: 'PIN replaced' }),
    ).toBeInTheDocument();
    expect(JSON.parse(String(credentialRequest(fetchMock)?.[1]?.body))).toEqual({
      pin: '2048',
    });
    expect(dialog).not.toHaveTextContent('2048');
  });

  it('updates password and PIN together in one request', async () => {
    fetchMock.mockResolvedValue(response(200, success(true, true)));
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Replace password or PIN' });

    await user.type(within(dialog).getByLabelText('New password'), 'new-pass');
    await user.type(within(dialog).getByLabelText('New PIN'), '7319');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save credential changes' }),
    );

    expect(
      await within(dialog).findByRole('heading', {
        name: 'Password and PIN replaced',
      }),
    ).toBeInTheDocument();
    expect(JSON.parse(String(credentialRequest(fetchMock)?.[1]?.body))).toEqual({
      password: 'new-pass',
      pin: '7319',
    });
    expect(dialog).not.toHaveTextContent('new-pass');
    expect(dialog).not.toHaveTextContent('7319');
  });

  it('refuses both blank fields at form level without calling the API', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Replace password or PIN' });

    await user.click(
      within(dialog).getByRole('button', { name: 'Save credential changes' }),
    );

    expect(
      within(dialog).getByText('Enter a new password, a new PIN, or both.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByLabelText('New password')).toHaveFocus();
    });
    expect(credentialRequest(fetchMock)).toBeUndefined();
  });

  it('refuses an explicitly emptied password and an invalid PIN with field-specific errors', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Replace password or PIN' });
    const password = within(dialog).getByLabelText('New password');
    const pin = within(dialog).getByLabelText('New PIN');

    await user.type(password, 'x');
    await user.clear(password);
    await user.type(pin, '12a4');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save credential changes' }),
    );

    expect(within(dialog).getAllByText('Enter a new password with at least 1 character.'))
      .toHaveLength(2);
    expect(within(dialog).getAllByText('Enter exactly four digits using 0 to 9 only.'))
      .toHaveLength(2);
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(pin).toHaveAttribute('aria-invalid', 'true');
    expect(credentialRequest(fetchMock)).toBeUndefined();
  });

  it('maps a field-attributed server validation error back to the PIN input', async () => {
    fetchMock.mockResolvedValue(
      response(400, {
        message: 'pin must contain exactly four digits',
        field: 'pin',
      }),
    );
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Replace password or PIN' });
    const pin = within(dialog).getByLabelText('New PIN');

    await user.type(pin, '2048');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save credential changes' }),
    );

    await waitFor(() => expect(pin).toHaveAttribute('aria-invalid', 'true'));
    expect(within(dialog).getAllByText(PIN_ERROR)).toHaveLength(2);
  });

  it.each([
    [
      409,
      { message: 'No account', reason: 'STAFF_MEMBER_HAS_NO_ACCOUNT' },
      'No login account',
      'does not have a login account',
    ],
    [404, { message: 'Not found' }, 'Staff member not found', 'Refresh the staff list'],
    [403, { message: 'Forbidden' }, 'Access denied', 'Administrator access is required'],
    [500, { message: 'Failure' }, 'Credential changes could not be saved', 'The previous password and PIN still work'],
  ])(
    'shows a distinct refusal for HTTP %s and keeps the draft available',
    async (status, body, title, expected) => {
      fetchMock.mockResolvedValue(response(status, body));
      const user = userEvent.setup();
      renderDialog();
      const dialog = screen.getByRole('dialog', { name: 'Replace password or PIN' });
      const pin = within(dialog).getByLabelText('New PIN');
      await user.type(pin, '2048');
      await user.click(
        within(dialog).getByRole('button', { name: 'Save credential changes' }),
      );

      expect(await within(dialog).findByText(title)).toBeInTheDocument();
      expect(within(dialog).getByText(new RegExp(expected))).toBeInTheDocument();
      expect(pin).toHaveValue('2048');
    },
  );
});
