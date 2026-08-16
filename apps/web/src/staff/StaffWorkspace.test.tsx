import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

function renderWorkspace() {
  return render(
    <SignedInAs staffMemberId="roster-id">
      <MemoryRouter initialEntries={['/pos/order']}>
        <StaffWorkspaceLayout />
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

  it('keeps the toggle outside the collapsible region and out of its own bar', () => {
    renderWorkspace();

    const toggle = screen.getByRole('button', { name: 'Hide menu' });
    const chrome = document.getElementById('staff-workspace-chrome')!;

    // Reachable when collapsed only if it is a sibling, not a descendant.
    expect(chrome.contains(toggle)).toBe(false);
    expect(toggle.getAttribute('aria-controls')).toBe('staff-workspace-chrome');
    // It shares the header row with the chrome rather than adding a bar.
    expect(toggle.parentElement).toBe(chrome.parentElement);
    expect(
      document.querySelector('.staff-workspace-toggle-bar'),
    ).toBeNull();
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
