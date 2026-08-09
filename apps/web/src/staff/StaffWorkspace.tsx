import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { DayType, type CurrentOpenBusinessDay } from '@coffee-shop/shared';
import { useAuth } from '../auth/AuthContext';
import { CashierControl } from '../cashier/CashierControl';
import { UcmLogo } from '../Logo';
import { getCurrentBusinessDay } from '../trading-day/api';

const NO_OPEN_BUSINESS_DAY: CurrentOpenBusinessDay = {
  isOpen: false,
  businessDate: null,
  dayType: null,
  openingFloatCents: null,
  openedByDisplayName: null,
  openedAt: null,
};

interface StaffWorkspaceContextValue {
  businessDay: CurrentOpenBusinessDay | null;
  businessDayLoadError: boolean;
  retryBusinessDay: () => void;
  setBusinessDay: (businessDay: CurrentOpenBusinessDay) => void;
}

const StaffWorkspaceContext = createContext<StaffWorkspaceContextValue | null>(
  null,
);
const ignoreBusinessDayChange = (businessDay: CurrentOpenBusinessDay) => {
  void businessDay;
};

interface StaffDestination {
  label: string;
  to: string;
  requiresOpenDay: boolean;
  separatorAfter?: boolean;
}

const STAFF_DESTINATIONS: readonly StaffDestination[] = [
  {
    label: 'Take Order',
    to: '/pos/order',
    requiresOpenDay: false,
    separatorAfter: true,
  },
  {
    label: 'Open Day',
    to: '/pos/open',
    requiresOpenDay: false,
    separatorAfter: true,
  },
  { label: 'Opening', to: '/pos/opening', requiresOpenDay: true },
  { label: 'Restock', to: '/pos/restock', requiresOpenDay: true },
  {
    label: 'Deliveries & Wastage',
    to: '/pos/movements',
    requiresOpenDay: true,
  },
  { label: 'Order History', to: '/pos/orders', requiresOpenDay: false },
  { label: 'Cash & Expenses', to: '/pos/cash', requiresOpenDay: true },
  {
    label: 'Closing',
    to: '/pos/closing',
    requiresOpenDay: true,
    separatorAfter: true,
  },
  { label: 'Close Day', to: '/pos/close', requiresOpenDay: true },
] as const;

function formatBusinessDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Manila',
  }).format(new Date(Date.UTC(year!, month! - 1, day)));
}

function dayTypeLabel(dayType: DayType | null): string {
  if (dayType === DayType.PEAK) return 'Peak day';
  if (dayType === DayType.NORMAL) return 'Normal day';
  return '';
}

function LockIcon() {
  return (
    <svg className="staff-nav-lock" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M7 10h10a1 1 0 0 1 1 1v8H6v-8a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function BusinessDayContext({
  businessDay,
  loadError,
  onRetry,
}: {
  businessDay: CurrentOpenBusinessDay | null;
  loadError: boolean;
  onRetry: () => void;
}) {
  if (loadError) {
    return (
      <div
        className="staff-workspace-day-context is-unavailable"
        aria-label="Business day context"
        aria-live="polite"
      >
        <div>
          <strong>Business day unavailable</strong>
          <span>Check the connection, then try again</span>
        </div>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (businessDay === null) {
    return (
      <div
        className="staff-workspace-day-context"
        aria-label="Business day context"
        aria-live="polite"
      >
        <div>
          <strong>Checking business day…</strong>
        </div>
      </div>
    );
  }

  if (!businessDay.isOpen || !businessDay.businessDate) {
    return (
      <div
        className="staff-workspace-day-context is-closed"
        aria-label="Business day context"
        aria-live="polite"
      >
        <div>
          <strong>No business day open</strong>
          <span>Open a day to record sales</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="staff-workspace-day-context"
      aria-label="Business day context"
      aria-live="polite"
    >
      <div>
        <strong>{formatBusinessDate(businessDay.businessDate)}</strong>
        <span>{dayTypeLabel(businessDay.dayType)}</span>
      </div>
    </div>
  );
}

function isCurrentDestination(pathname: string, destination: string): boolean {
  return pathname === destination || pathname.startsWith(`${destination}/`);
}

export function useStaffWorkspaceBusinessDay() {
  const context = useContext(StaffWorkspaceContext);
  return {
    businessDay: context?.businessDay ?? null,
    businessDayLoadError: context?.businessDayLoadError ?? false,
    retryBusinessDay: context?.retryBusinessDay ?? (() => undefined),
    setBusinessDay: context?.setBusinessDay ?? ignoreBusinessDayChange,
    clearBusinessDay: () => context?.setBusinessDay(NO_OPEN_BUSINESS_DAY),
  };
}

export function StaffWorkspaceLayout() {
  const auth = useAuth();
  const location = useLocation();
  const navigationRef = useRef<HTMLElement>(null);
  const [businessDay, setBusinessDay] =
    useState<CurrentOpenBusinessDay | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadError(false);

    void getCurrentBusinessDay()
      .then((day) => {
        if (active) setBusinessDay(day);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });

    return () => {
      active = false;
    };
  }, [loadVersion]);

  useEffect(() => {
    const navigation = navigationRef.current;
    const current = navigation?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    if (!navigation || !current) return;

    const itemStart = current.offsetLeft;
    const itemEnd = itemStart + current.offsetWidth;
    const visibleStart = navigation.scrollLeft;
    const visibleEnd = visibleStart + navigation.clientWidth;

    if (itemStart < visibleStart) {
      navigation.scrollLeft = itemStart;
    } else if (itemEnd > visibleEnd) {
      navigation.scrollLeft = itemEnd - navigation.clientWidth;
    }
  }, [location.pathname]);

  return (
    <StaffWorkspaceContext.Provider
      value={{
        businessDay,
        businessDayLoadError: loadError,
        retryBusinessDay: () => setLoadVersion((version) => version + 1),
        setBusinessDay,
      }}
    >
      <div className="staff-inventory-shell">
        <a className="staff-skip-link" href="#staff-main">
          Skip to staff workspace
        </a>
        <header className="staff-workspace-header">
          <div className="staff-workspace-header-inner">
            <div className="staff-workspace-context-row">
              <div className="staff-workspace-brand">
                <UcmLogo size="inline" />
                <div>
                  <div className="staff-workspace-brand-title">
                    <strong>UCM Coffee Studio</strong>
                    <span className="staff-workspace-brand-role">Staff</span>
                  </div>
                  <small>
                    Signed in as {auth.user?.displayName ?? auth.user?.username}
                  </small>
                </div>
              </div>
              <BusinessDayContext
                businessDay={businessDay}
                loadError={loadError}
                onRetry={() => setLoadVersion((version) => version + 1)}
              />
            </div>
            <CashierControl />
            <nav
              className="staff-inventory-nav"
              aria-label="Staff workspace"
              ref={navigationRef}
            >
              <ul>
                {STAFF_DESTINATIONS.map((destination) => {
                  const isUnavailable =
                    destination.requiresOpenDay && !businessDay?.isOpen;
                  const isCurrent = isCurrentDestination(
                    location.pathname,
                    destination.to,
                  );
                  return (
                    <li key={destination.to}>
                      {isUnavailable ? (
                        <span
                          className="staff-nav-item is-unavailable"
                          role="link"
                          aria-disabled="true"
                          aria-current={isCurrent ? 'page' : undefined}
                          aria-label={`${destination.label}, unavailable until a business day is open`}
                        >
                          <LockIcon />
                          <span>{destination.label}</span>
                        </span>
                      ) : (
                        <NavLink
                          className="staff-nav-item"
                          to={destination.to}
                          end={destination.to === '/pos'}
                        >
                          {destination.label}
                        </NavLink>
                      )}
                      {destination.separatorAfter && (
                        <span
                          className="staff-nav-separator"
                          role="separator"
                          aria-hidden="true"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </header>
        <Outlet />
      </div>
    </StaffWorkspaceContext.Provider>
  );
}
