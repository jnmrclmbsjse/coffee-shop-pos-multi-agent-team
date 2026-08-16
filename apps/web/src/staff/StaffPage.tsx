import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type {
  SortDirection,
  StaffMember,
  StaffMemberListSort,
} from '@coffee-shop/shared';
import {
  Icon,
  LoadingRows,
  Notice,
  StateBadge,
  Switch,
} from '../catalog/components';
import {
  createStaffMember,
  listStaffMembers,
  StaffApiError,
  updateStaffMember,
} from './api';
import { StaffAccountDialog } from './StaffAccountDialog';

type ActiveFilter = 'all' | 'true' | 'false';

interface StaffDraft {
  id?: string;
  displayName: string;
  isActive: boolean;
}

const EMPTY_DRAFT: StaffDraft = {
  displayName: '',
  isActive: true,
};

const NAME_REQUIRED_MESSAGE =
  'Name is required. Enter at least one visible character.';

function activeValue(filter: ActiveFilter): boolean | undefined {
  return filter === 'all' ? undefined : filter === 'true';
}

function staffErrorMessage(error: unknown, fallback: string): string {
  return error instanceof StaffApiError
    ? error.messages.join(' ')
    : fallback;
}

export function StaffPage() {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilter, setActiveFilter] =
    useState<ActiveFilter>('all');
  const [sort, setSort] = useState<StaffMemberListSort>('name');
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<StaffDraft | null>(null);
  const [accountMember, setAccountMember] = useState<StaffMember | null>(null);
  const [nameError, setNameError] = useState('');
  const [modalError, setModalError] = useState('');
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    document.title = 'Staff · UCM Coffee Studio';
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let currentRequest = true;
    setLoading(true);
    setPageError('');

    void listStaffMembers({
      search: debouncedSearch || undefined,
      active: activeValue(activeFilter),
      sort,
      direction,
    })
      .then((result) => {
        if (currentRequest) setMembers(result);
      })
      .catch(() => {
        if (currentRequest) {
          setPageError(
            'The staff roster could not be loaded. Refresh the page to try again.',
          );
        }
      })
      .finally(() => {
        if (currentRequest) setLoading(false);
      });

    return () => {
      currentRequest = false;
    };
  }, [activeFilter, debouncedSearch, direction, refreshKey, sort]);

  useEffect(() => {
    if (!draft) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) closeDialog();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [draft, saving]);

  useEffect(() => {
    if (draft) requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [Boolean(draft)]);

  function openDialog(member?: StaffMember) {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : addButtonRef.current;
    setNameError('');
    setModalError('');
    setDraft(
      member
        ? {
            id: member.id,
            displayName: member.displayName,
            isActive: member.isActive,
          }
        : { ...EMPTY_DRAFT },
    );
  }

  function closeDialog() {
    if (saving) return;
    setDraft(null);
    setNameError('');
    setModalError('');
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  function openAccountDialog(member: StaffMember) {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setNotice('');
    setAccountMember(member);
  }

  function closeAccountDialog(created: boolean) {
    const memberName = accountMember?.displayName;
    setAccountMember(null);
    if (created && memberName) {
      setNotice(`${memberName}'s login account was created.`);
    }
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  async function saveStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;

    const displayName = draft.displayName.trim();
    if (!displayName) {
      setNameError(NAME_REQUIRED_MESSAGE);
      requestAnimationFrame(() => nameInputRef.current?.focus());
      return;
    }

    setSaving(true);
    setNameError('');
    setModalError('');
    setPageError('');
    try {
      const saved = draft.id
        ? await updateStaffMember(draft.id, {
            displayName,
            isActive: draft.isActive,
          })
        : await createStaffMember({
            displayName,
            isActive: draft.isActive,
          });
      setDraft(null);
      setNotice(
        `${saved.displayName} was ${draft.id ? 'updated' : 'added'}.`,
      );
      setRefreshKey((key) => key + 1);
      requestAnimationFrame(() => previousFocusRef.current?.focus());
    } catch (error) {
      const message = staffErrorMessage(
        error,
        'The staff member could not be saved. Try again.',
      );
      if (
        message.toLocaleLowerCase('en-US').includes('displayname') ||
        message.toLocaleLowerCase('en-US').includes('blank')
      ) {
        setNameError(NAME_REQUIRED_MESSAGE);
        requestAnimationFrame(() => nameInputRef.current?.focus());
      } else {
        setModalError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(member: StaffMember) {
    if (updatingId) return;
    setUpdatingId(member.id);
    setPageError('');
    setNotice('');
    try {
      const updated = await updateStaffMember(member.id, {
        isActive: !member.isActive,
      });
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice(
        `${updated.displayName} is now ${
          updated.isActive ? 'active' : 'inactive'
        }.`,
      );
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setPageError(
        staffErrorMessage(
          error,
          'The staff status could not be changed. Try again.',
        ),
      );
    } finally {
      setUpdatingId('');
    }
  }

  const hasMatchCriteria =
    Boolean(debouncedSearch) || activeFilter !== 'all';
  const hasNoResults =
    !loading && members.length === 0 && hasMatchCriteria;
  const rosterIsEmpty =
    !loading && members.length === 0 && !hasMatchCriteria;

  function clearCriteria() {
    setSearch('');
    setDebouncedSearch('');
    setActiveFilter('all');
  }

  return (
    <main className="catalog-page staff-page">
      <div className="catalog-page-head">
        <div>
          <h1>Staff</h1>
          <p>Manage names used to identify cashiers at the register.</p>
        </div>
        <button
          className="catalog-button primary"
          ref={addButtonRef}
          type="button"
          onClick={() => openDialog()}
        >
          <Icon name="plus" />
          Add staff
        </button>
      </div>

      {pageError && <Notice tone="danger" title={pageError} />}
      {notice && !pageError && <Notice tone="success" title={notice} />}

      <section className="catalog-panel" aria-labelledby="staff-roster-heading">
        <h2 className="sr-only" id="staff-roster-heading">
          Staff roster
        </h2>
        <div className="staff-filters">
          <div className="search-control">
            <label className="sr-only" htmlFor="staff-search">
              Search staff
            </label>
            <Icon name="search" />
            <input
              id="staff-search"
              type="search"
              autoComplete="off"
              placeholder="Search by name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <label>
            <span>Status</span>
            <select
              aria-label="Status"
              value={activeFilter}
              onChange={(event) =>
                setActiveFilter(event.target.value as ActiveFilter)
              }
            >
              <option value="all">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select
              aria-label="Sort by"
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as StaffMemberListSort)
              }
            >
              <option value="name">Name</option>
              <option value="active">Is active</option>
            </select>
          </label>
          <div className="staff-direction-field">
            <span>Direction</span>
            <button
              className="catalog-button staff-direction-button"
              type="button"
              aria-label={`Sort direction: ${direction}. Change to ${
                direction === 'asc' ? 'descending' : 'ascending'
              }`}
              onClick={() =>
                setDirection((current) =>
                  current === 'asc' ? 'desc' : 'asc',
                )
              }
            >
              <span aria-hidden="true">
                {direction === 'asc' ? '↑' : '↓'}
              </span>
              {direction === 'asc' ? 'Ascending' : 'Descending'}
            </button>
          </div>
        </div>

        <div className="results-meta">
          <span aria-live="polite">
            {loading
              ? 'Loading staff'
              : `${members.length} ${
                  members.length === 1 ? 'staff member' : 'staff members'
                } shown`}
          </span>
          {hasMatchCriteria && (
            <button
              className="inventory-clear-filters"
              type="button"
              onClick={clearCriteria}
            >
              Clear search and filter
            </button>
          )}
        </div>

        <div className="catalog-table-wrap">
          <table className="catalog-table staff-table">
            <caption className="sr-only">
              Staff roster with active status and row actions
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Is active</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRows columns={3} />
              ) : rosterIsEmpty || hasNoResults ? (
                <tr>
                  <td colSpan={3}>
                    <div className="catalog-empty staff-empty">
                      <Icon name={rosterIsEmpty ? 'box' : 'search'} />
                      <h3>
                        {rosterIsEmpty
                          ? 'No staff members yet'
                          : 'No staff match your search or filter'}
                      </h3>
                      <p>
                        {rosterIsEmpty
                          ? 'Add the first staff member so their name is ready for cashier attribution.'
                          : 'Clear the search or show all statuses to see more staff members.'}
                      </p>
                      {rosterIsEmpty ? (
                        <button
                          className="catalog-button"
                          type="button"
                          onClick={() => openDialog()}
                        >
                          Add staff
                        </button>
                      ) : (
                        <button
                          className="catalog-button"
                          type="button"
                          onClick={clearCriteria}
                        >
                          Clear search and filter
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.id}>
                    <td data-label="Name">
                      <strong>{member.displayName}</strong>
                    </td>
                    <td data-label="Is active">
                      <div className="staff-status-control">
                        <StateBadge
                          active={member.isActive}
                          trueLabel="Active"
                          falseLabel="Inactive"
                        />
                        <Switch
                          checked={member.isActive}
                          label={`${
                            member.isActive ? 'Deactivate' : 'Activate'
                          } ${member.displayName}`}
                          disabled={updatingId === member.id}
                          onChange={() => void toggleActive(member)}
                        />
                      </div>
                    </td>
                    <td data-label="Actions" className="table-action">
                      <div className="staff-row-actions">
                        <button
                          className="catalog-button small"
                          type="button"
                          aria-label={`Edit ${member.displayName}`}
                          onClick={() => openDialog(member)}
                        >
                          Edit
                        </button>
                        {member.isActive ? (
                          <button
                            className="catalog-button small"
                            type="button"
                            aria-label={`${
                              member.hasAccount
                                ? 'Manage login account for'
                                : 'Create login account for'
                            } ${member.displayName}`}
                            onClick={() => openAccountDialog(member)}
                          >
                            {member.hasAccount
                              ? 'Manage login account'
                              : 'Create login account'}
                          </button>
                        ) : (
                          <span className="staff-account-unavailable">
                            Activate staff to create an account
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {draft && (
        <div
          className="inventory-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            className="inventory-modal staff-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-dialog-title"
            aria-describedby="staff-dialog-description"
          >
            <div className="inventory-modal-head">
              <div>
                <h2 id="staff-dialog-title">
                  {draft.id ? 'Edit staff' : 'Add staff'}
                </h2>
                <p id="staff-dialog-description">
                  {draft.id
                    ? 'Update this roster entry without changing its identity.'
                    : 'Names appear in the roster exactly as saved.'}
                </p>
              </div>
              <button
                className="catalog-button small"
                type="button"
                aria-label="Close staff editor"
                disabled={saving}
                onClick={closeDialog}
              >
                Close
              </button>
            </div>
            <form noValidate onSubmit={saveStaff}>
              <div className="catalog-field">
                <label htmlFor="staff-display-name">
                  Name <span aria-hidden="true">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  id="staff-display-name"
                  autoComplete="off"
                  value={draft.displayName}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={
                    nameError
                      ? 'staff-name-hint staff-name-error'
                      : 'staff-name-hint'
                  }
                  disabled={saving}
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      displayName: event.target.value,
                    });
                    setNameError('');
                    setModalError('');
                  }}
                />
                <p className="catalog-field-help" id="staff-name-hint">
                  Use the name staff recognize at the register.
                </p>
                {nameError && (
                  <p className="catalog-field-error" id="staff-name-error">
                    {nameError}
                  </p>
                )}
              </div>
              <div className="catalog-field">
                <label htmlFor="staff-active-state">Is active</label>
                <select
                  id="staff-active-state"
                  value={draft.isActive ? 'true' : 'false'}
                  disabled={saving}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      isActive: event.target.value === 'true',
                    })
                  }
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
              {modalError && (
                <Notice tone="danger" title={modalError} />
              )}
              <div className="staff-modal-actions">
                <button
                  className="catalog-button"
                  type="button"
                  disabled={saving}
                  onClick={closeDialog}
                >
                  Cancel
                </button>
                <button
                  className="catalog-button primary"
                  type="submit"
                  disabled={saving}
                >
                  {saving
                    ? 'Saving…'
                    : draft.id
                      ? 'Save changes'
                      : 'Add staff'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {accountMember && (
        <StaffAccountDialog
          member={accountMember}
          onClose={closeAccountDialog}
        />
      )}
    </main>
  );
}
