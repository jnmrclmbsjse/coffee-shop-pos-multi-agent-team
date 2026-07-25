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
});
