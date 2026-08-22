import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignedInAs } from '../auth/session-test-utils';
import { StaffWorkspaceLayout } from './StaffWorkspace';

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const noOpenDay = {
  isOpen: false,
  businessDate: null,
  dayType: null,
  openingFloatCents: null,
  openedByDisplayName: null,
  openedAt: null,
};

function renderWorkspace(initialEntry = '/pos/order') {
  return render(
    <SignedInAs staffMemberId="roster-id">
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/pos" element={<StaffWorkspaceLayout />}>
            <Route
              path="order"
              element={<main id="staff-main">Take Order</main>}
            />
            <Route
              path="orders"
              element={<main id="staff-main">Order History</main>}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </SignedInAs>,
  );
}

describe('staff workspace navigation toggle', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => response(200, noOpenDay));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('hides the workspace chrome and keeps the toggle reachable', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const toggle = screen.getByRole('button', { name: 'Hide menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('navigation', { name: 'Staff workspace' }),
    ).toBeInTheDocument();

    await user.click(toggle);

    const showToggle = screen.getByRole('button', { name: 'Show menu' });
    expect(showToggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('navigation', { name: 'Staff workspace' }),
    ).not.toBeInTheDocument();

    await user.click(showToggle);

    expect(
      screen.getByRole('navigation', { name: 'Staff workspace' }),
    ).toBeInTheDocument();
  });

  it('collapses only the cashier row and the nav, never the top bar', () => {
    renderWorkspace();

    const chrome = document.getElementById('staff-workspace-chrome')!;
    const toggle = screen.getByRole('button', { name: 'Hide menu' });
    const contextRow = document.querySelector(
      '.staff-workspace-context-row',
    )!;
    const cashier = document.querySelector('.cashier-shell-control')!;
    const nav = screen.getByRole('navigation', { name: 'Staff workspace' });

    // Persistent: the context row and the toggle survive a collapse.
    expect(chrome.contains(contextRow)).toBe(false);
    expect(chrome.contains(toggle)).toBe(false);
    expect(contextRow.parentElement).toBe(toggle.parentElement);

    // Collapsible: the cashier control and the nav are the only casualties.
    expect(chrome.contains(cashier)).toBe(true);
    expect(chrome.contains(nav)).toBe(true);

    expect(toggle.getAttribute('aria-controls')).toBe('staff-workspace-chrome');
    expect(document.querySelector('.staff-workspace-toggle-bar')).toBeNull();
  });

  it('keeps route content in the workspace remainder across menu states', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const content = document.querySelector<HTMLElement>(
      '.staff-workspace-content',
    );
    const main = document.getElementById('staff-main');

    expect(content).toContainElement(main);
    expect(content).toHaveClass('is-fitted');

    await user.click(screen.getByRole('button', { name: 'Hide menu' }));

    expect(content).toContainElement(main);
    expect(document.querySelector('.staff-inventory-shell')).toContainElement(
      content,
    );
  });

  it('keeps flow-height route content intrinsic', () => {
    renderWorkspace('/pos/orders');

    expect(document.querySelector('.staff-workspace-content')).not.toHaveClass(
      'is-fitted',
    );
  });

  it('keeps the brand, day context and logout on screen while collapsed', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'Hide menu' }));

    expect(screen.getByText('UCM Coffee Studio')).toBeVisible();
    expect(screen.getByText(/Signed in as/)).toBeVisible();
    expect(
      screen.getByLabelText('Business day context'),
    ).toBeVisible();
    expect(
      document.querySelector('.staff-workspace-context-row'),
    ).toBeVisible();
    // …while the two collapsible rows are gone from the accessibility tree.
    expect(
      screen.queryByRole('navigation', { name: 'Staff workspace' }),
    ).not.toBeInTheDocument();
    expect(document.getElementById('staff-workspace-chrome')).not.toBeVisible();
  });

  it('remembers a hidden navigation across a remount', async () => {
    const user = userEvent.setup();
    const first = renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'Hide menu' }));
    first.unmount();

    renderWorkspace();

    expect(
      screen.getByRole('button', { name: 'Show menu' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Staff workspace' }),
    ).not.toBeInTheDocument();
  });
});
