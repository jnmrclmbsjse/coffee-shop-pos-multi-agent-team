import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link } from 'react-router-dom';
import {
  LineDiscountKind,
  LinePreference,
  ServiceType,
  type CatalogCategorySummary,
  type LineItem,
  type Order,
  type Product,
  type UpdateOrderLineInput,
} from '@coffee-shop/shared';
import { getDeviceId } from '../auth/device';
import {
  listCategories,
  listProducts,
  updateProductAvailability,
} from '../catalog/api';
import { formatPeso } from '../catalog/money';
import { useStaffWorkspaceBusinessDay } from '../staff/StaffWorkspace';
import {
  addOrderLine,
  createOrder,
  decrementOrderLine,
  incrementOrderLine,
  listParkedOrders,
  OrderCaptureApiError,
  removeOrderLine,
  updateOrder,
  updateOrderLine,
} from './api';

type EditorKind = 'preferences' | 'discount' | 'upsize';

interface EditorState {
  kind: EditorKind;
  lineId: string;
}

const PREFERENCE_LABELS: Record<LinePreference, string> = {
  [LinePreference.SWEETER]: 'Sweeter',
  [LinePreference.STRONGER]: 'Stronger',
  [LinePreference.LESS_SWEET]: 'Less sweet',
  [LinePreference.LESS_ICE]: 'Less ice',
};

const DISCOUNT_LABELS: Record<LineDiscountKind, string> = {
  [LineDiscountKind.NONE]: 'None',
  [LineDiscountKind.PWD]: 'PWD',
  [LineDiscountKind.SENIOR]: 'Senior',
};

function newClientGeneratedId(): string {
  return globalThis.crypto.randomUUID();
}

function orderErrorMessage(error: unknown): string {
  return error instanceof OrderCaptureApiError
    ? error.message
    : 'The order change could not be saved. Try again.';
}

function deduction(cents: number): string {
  return cents === 0 ? formatPeso(0) : `−${formatPeso(cents)}`;
}

function itemCount(order: Order): number {
  return order.lines.reduce((total, line) => total + line.quantity, 0);
}

function lineName(line: LineItem): string {
  return `${line.productNameSnapshot}, ${line.variantNameSnapshot}`;
}

function LineEditor({
  kind,
  line,
  isSaving,
  onClose,
  onSave,
}: {
  kind: EditorKind;
  line: LineItem;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: UpdateOrderLineInput) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [preferences, setPreferences] = useState<LinePreference[]>(
    line.preferences,
  );
  const [note, setNote] = useState(line.preferenceNote ?? '');
  const [discountKind, setDiscountKind] = useState(line.discountKind);
  const [freeUpsizeCount, setFreeUpsizeCount] = useState(
    line.freeUpsizeCount,
  );
  const trimmedNoteLength = note.trim().length;
  const title =
    kind === 'preferences'
      ? `Preferences for ${lineName(line)}`
      : kind === 'discount'
        ? `Discount for ${lineName(line)}`
        : `Free upsize for ${lineName(line)}`;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLElement>('button, input, textarea')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isSaving, onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (kind === 'preferences') {
      if (trimmedNoteLength > 255) return;
      void onSave({
        preferences,
        preferenceNote: note.trim() || null,
      });
    } else if (kind === 'discount') {
      void onSave({ discountKind });
    } else {
      void onSave({ freeUpsizeCount });
    }
  };

  const togglePreference = (preference: LinePreference) => {
    setPreferences((current) =>
      current.includes(preference)
        ? current.filter((value) => value !== preference)
        : [...current, preference],
    );
  };

  return (
    <div className="order-dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="order-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-editor-title"
      >
        <form onSubmit={submit}>
          <header className="order-dialog-header">
            <div>
              <span>
                {kind === 'upsize' ? 'Promotion' : 'Line customization'}
              </span>
              <h2 id="order-editor-title">{title}</h2>
            </div>
            <button type="button" onClick={onClose} disabled={isSaving}>
              Close
            </button>
          </header>

          {kind === 'preferences' && (
            <div className="order-dialog-body">
              <fieldset className="order-choice-fieldset">
                <legend>Choose any that apply</legend>
                <div className="order-check-grid">
                  {Object.values(LinePreference).map((preference) => (
                    <label key={preference}>
                      <input
                        type="checkbox"
                        checked={preferences.includes(preference)}
                        onChange={() => togglePreference(preference)}
                      />
                      <span>{PREFERENCE_LABELS[preference]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {preferences.includes(LinePreference.SWEETER) &&
                preferences.includes(LinePreference.LESS_SWEET) && (
                  <p className="order-editor-note">
                    Sweeter and Less sweet are both selected. This combination
                    will be saved as requested.
                  </p>
                )}
              <label className="order-field" htmlFor="preference-note">
                <span>Preparation note (optional)</span>
                <textarea
                  id="preference-note"
                  value={note}
                  rows={4}
                  aria-invalid={trimmedNoteLength > 255}
                  aria-describedby="preference-note-count preference-note-error"
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <p
                id="preference-note-count"
                className="order-character-count"
                aria-live="polite"
              >
                {trimmedNoteLength} / 255 characters
              </p>
              {trimmedNoteLength > 255 && (
                <p id="preference-note-error" className="order-field-error" role="alert">
                  Shorten the note to 255 characters or fewer.
                </p>
              )}
            </div>
          )}

          {kind === 'discount' && (
            <div className="order-dialog-body">
              <fieldset className="order-choice-fieldset">
                <legend>Apply to this line only</legend>
                <div className="order-radio-stack">
                  {Object.values(LineDiscountKind).map((discount) => (
                    <label key={discount}>
                      <input
                        type="radio"
                        name="line-discount"
                        value={discount}
                        checked={discountKind === discount}
                        onChange={() => setDiscountKind(discount)}
                      />
                      <span>{DISCOUNT_LABELS[discount]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="order-editor-note">
                PWD and Senior are recorded without customer ID details. The
                server returns the discount amount for this line.
              </p>
            </div>
          )}

          {kind === 'upsize' && (
            <div className="order-dialog-body">
              <p className="order-editor-note is-promotion">
                This promotion belongs to this eligible line and is shown
                separately from PWD or Senior discount.
              </p>
              <div className="order-upsize-stepper" role="group" aria-label="Free upsize count">
                <button
                  type="button"
                  aria-label="Decrease free upsize count"
                  disabled={freeUpsizeCount === 0}
                  onClick={() => setFreeUpsizeCount((count) => count - 1)}
                >
                  −
                </button>
                <output aria-live="polite">
                  <strong>{freeUpsizeCount}</strong>
                  <span>of {line.quantity} drinks</span>
                </output>
                <button
                  type="button"
                  aria-label="Increase free upsize count"
                  disabled={freeUpsizeCount === line.quantity}
                  onClick={() => setFreeUpsizeCount((count) => count + 1)}
                >
                  +
                </button>
              </div>
              <p className="order-editor-note">
                Choose from zero through this line’s quantity. The saved value
                is returned by the server with updated totals.
              </p>
            </div>
          )}

          <footer className="order-dialog-actions">
            <button type="button" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button
              className="is-primary"
              type="submit"
              disabled={isSaving || (kind === 'preferences' && trimmedNoteLength > 255)}
            >
              {isSaving ? 'Saving…' : 'Save line'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export function TakeOrderPage() {
  const {
    businessDay,
    businessDayLoadError,
    retryBusinessDay,
  } = useStaffWorkspaceBusinessDay();
  const deviceIdRef = useRef<string | null>(null);
  const [clientGeneratedId, setClientGeneratedId] = useState(
    newClientGeneratedId,
  );
  const [categories, setCategories] = useState<CatalogCategorySummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [parkedOrders, setParkedOrders] = useState<Order[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [serviceType, setServiceType] = useState(ServiceType.DINE_IN);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (deviceIdRef.current === null) deviceIdRef.current = getDeviceId();

  useEffect(() => {
    document.title = 'Take Order · UCM Coffee Studio';
  }, []);

  useEffect(() => {
    if (message === null) return;
    const timeout = window.setTimeout(() => setMessage(null), 3_000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const loadWorkspace = useCallback(async () => {
    if (!businessDay?.isOpen) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(false);
    setErrorMessage(null);
    try {
      const [nextCategories, nextProducts, nextParkedOrders] =
        await Promise.all([
          listCategories(),
          listProducts({ active: true, sort: 'category' }),
          listParkedOrders(),
        ]);
      const activeCategories = nextCategories.filter((category) => category.active);
      setCategories(activeCategories);
      setProducts(nextProducts.filter((product) => product.active));
      setParkedOrders(nextParkedOrders);
      setActiveCategoryId((current) =>
        current && activeCategories.some((category) => category.id === current)
          ? current
          : (activeCategories[0]?.id ?? null),
      );
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [businessDay?.isOpen]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const clearDraft = (reuseClientId: boolean) => {
    setOrder(null);
    setCustomerName('');
    setServiceType(ServiceType.DINE_IN);
    setEditor(null);
    if (!reuseClientId) setClientGeneratedId(newClientGeneratedId());
  };

  const runOrderMutation = async (
    key: string,
    mutation: () => Promise<Order | null>,
    successMessage?: string,
  ) => {
    if (pendingAction !== null) return;
    setPendingAction(key);
    setErrorMessage(null);
    setMessage(null);
    try {
      const result = await mutation();
      if (result === null) {
        clearDraft(true);
        setMessage('Empty order discarded.');
      } else {
        setOrder(result);
        setCustomerName(result.customerName ?? '');
        setServiceType(result.serviceType);
        if (successMessage) setMessage(successMessage);
      }
      return result;
    } catch (error) {
      setErrorMessage(orderErrorMessage(error));
      return undefined;
    } finally {
      setPendingAction(null);
    }
  };

  const addVariant = async (productVariantId: string) => {
    const input = { productVariantId };
    await runOrderMutation('add-line', () =>
      order
        ? addOrderLine(order.clientGeneratedId, input)
        : createOrder({
            ...input,
            clientGeneratedId,
            deviceId: deviceIdRef.current!,
            customerName: customerName.trim() || null,
            serviceType,
          }),
    );
  };

  const saveCustomerName = async () => {
    const normalized = customerName.trim();
    if (!order || normalized === (order.customerName ?? '')) return;
    await runOrderMutation('order-header', () =>
      updateOrder(order.clientGeneratedId, {
        customerName: normalized || null,
      }),
    );
  };

  const chooseServiceType = async (nextServiceType: ServiceType) => {
    if (nextServiceType === serviceType) return;
    if (!order) {
      setServiceType(nextServiceType);
      return;
    }
    await runOrderMutation('order-header', () =>
      updateOrder(order.clientGeneratedId, { serviceType: nextServiceType }),
    );
  };

  const toggleAvailability = async (product: Product) => {
    if (pendingAction !== null) return;
    setPendingAction(`availability-${product.id}`);
    setErrorMessage(null);
    try {
      const updated = await updateProductAvailability(
        product.id,
        !product.available,
      );
      setProducts((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
      setMessage(
        `${product.name} marked ${updated.available ? 'available' : 'sold out'}.`,
      );
    } catch {
      setErrorMessage('Availability could not be changed. Try again.');
    } finally {
      setPendingAction(null);
    }
  };

  const changeLine = async (
    action: 'increment' | 'decrement' | 'remove',
    line: LineItem,
  ) => {
    if (!order) return;
    const operation =
      action === 'increment'
        ? () => incrementOrderLine(order.clientGeneratedId, line.id)
        : action === 'decrement'
          ? () => decrementOrderLine(order.clientGeneratedId, line.id)
          : () => removeOrderLine(order.clientGeneratedId, line.id);
    await runOrderMutation(`${action}-${line.id}`, operation);
  };

  const saveLineEditor = async (input: UpdateOrderLineInput) => {
    if (!order || !editor) return;
    const result = await runOrderMutation('line-editor', () =>
      updateOrderLine(order.clientGeneratedId, editor.lineId, input),
    );
    if (result) setEditor(null);
  };

  const parkCurrentOrder = async () => {
    if (!order) {
      clearDraft(false);
      setMessage('Empty order discarded.');
      return;
    }
    clearDraft(false);
    setMessage(`Order #${order.dayOrderNumber} parked.`);
    try {
      setParkedOrders(await listParkedOrders());
    } catch {
      setErrorMessage('The order was parked, but the parked list could not be refreshed.');
    }
  };

  const resumeOrder = (parkedOrder: Order) => {
    setClientGeneratedId(parkedOrder.clientGeneratedId);
    setOrder(parkedOrder);
    setCustomerName(parkedOrder.customerName ?? '');
    setServiceType(parkedOrder.serviceType);
    setMessage(`Order #${parkedOrder.dayOrderNumber} resumed.`);
    setErrorMessage(null);
  };

  if (businessDayLoadError) {
    return (
      <main id="staff-main" className="take-order-state">
        <div>
          <h1>Business day could not be checked</h1>
          <p>Check the connection before starting an order.</p>
          <button type="button" onClick={retryBusinessDay}>Try again</button>
        </div>
      </main>
    );
  }

  if (businessDay === null || isLoading) {
    return (
      <main id="staff-main" className="take-order-state" aria-live="polite">
        <div>
          <h1>Loading Take Order</h1>
          <p>Checking the business day, catalog, and parked orders.</p>
        </div>
      </main>
    );
  }

  if (!businessDay.isOpen) {
    return (
      <main id="staff-main" className="take-order-state">
        <div>
          <span className="take-order-state-icon" aria-hidden="true">!</span>
          <h1>No business day is open</h1>
          <p>
            An order cannot be started until today’s business day is open.
          </p>
          <Link to="/pos/open">Open business day</Link>
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main id="staff-main" className="take-order-state">
        <div>
          <h1>Take Order could not be loaded</h1>
          <p>Check the connection, then reload the catalog and parked orders.</p>
          <button type="button" onClick={() => void loadWorkspace()}>Try again</button>
        </div>
      </main>
    );
  }

  const normalizedSearch = search.trim().toLocaleLowerCase('en-US');
  const visibleProducts = products.filter(
    (product) =>
      product.category.active &&
      product.variants.some((variant) => variant.active) &&
      (normalizedSearch.length === 0 ||
        product.name.toLocaleLowerCase('en-US').includes(normalizedSearch)),
  );
  const activeEditorLine = editor
    ? order?.lines.find((line) => line.id === editor.lineId) ?? null
    : null;
  const otherParkedOrders = parkedOrders.filter(
    (parkedOrder) => parkedOrder.id !== order?.id,
  );

  return (
    <main id="staff-main" className="take-order-page">
      <div className="take-order-announcements" aria-live="polite" aria-atomic="true">
        {message && <p className="take-order-message">{message}</p>}
        {errorMessage && <p className="take-order-error" role="alert">{errorMessage}</p>}
      </div>

      <section className="take-order-catalog" aria-labelledby="take-order-title">
        <header className="take-order-pane-heading">
          <div>
            <h1 id="take-order-title">Take order</h1>
            <p>Select a size to add it to the current order.</p>
          </div>
          <label>
            <span className="sr-only">Search products</span>
            <input
              type="search"
              value={search}
              placeholder="Search products"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </header>

        <nav className="take-order-categories" aria-label="Product categories">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-pressed={activeCategoryId === category.id}
              aria-controls={`order-category-${category.id}`}
              onClick={() => {
                setActiveCategoryId(category.id);
                document
                  .getElementById(`order-category-${category.id}`)
                  ?.scrollIntoView({ behavior: 'auto', block: 'start' });
              }}
            >
              {category.name}
            </button>
          ))}
        </nav>

        <div className="take-order-product-scroll">
          {categories.map((category) => {
            const categoryProducts = visibleProducts.filter(
              (product) => product.categoryId === category.id,
            );
            if (categoryProducts.length === 0) return null;
            return (
              <section
                id={`order-category-${category.id}`}
                className="take-order-category-section"
                key={category.id}
                aria-labelledby={`order-category-title-${category.id}`}
              >
                <header>
                  <h2 id={`order-category-title-${category.id}`}>{category.name}</h2>
                  {category.freeUpsizeEligible && <span>Free upsize eligible</span>}
                </header>
                <div className="take-order-product-grid">
                  {categoryProducts.map((product) => (
                    <article
                      key={product.id}
                      className={`take-order-product${product.available ? '' : ' is-sold-out'}`}
                    >
                      <div className="take-order-product-heading">
                        <div>
                          <h3>{product.name}</h3>
                          <span className="take-order-product-state">
                            {product.available ? 'Available' : 'Sold out · Unbuyable'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="take-order-availability"
                          aria-pressed={!product.available}
                          disabled={pendingAction !== null}
                          onClick={() => void toggleAvailability(product)}
                        >
                          {product.available ? 'Mark sold out' : 'Mark available'}
                        </button>
                      </div>
                      <div className="take-order-size-grid" aria-label={`Sizes for ${product.name}`}>
                        {product.variants
                          .filter((variant) => variant.active)
                          .map((variant) => (
                            <button
                              key={variant.id}
                              type="button"
                              disabled={!product.available || pendingAction !== null}
                              onClick={() => void addVariant(variant.id)}
                            >
                              <span>{variant.name}</span>
                              <strong>{formatPeso(variant.priceCents)}</strong>
                            </button>
                          ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
          {visibleProducts.length === 0 && (
            <div className="take-order-empty-catalog">
              <strong>No matching products</strong>
              <span>Clear the search to see the active catalog.</span>
            </div>
          )}
        </div>
      </section>

      <aside className="take-order-current" aria-labelledby="current-order-title">
        <header className="current-order-header">
          <div>
            <span>Current order</span>
            <h2 id="current-order-title">
              {order ? `Order #${order.dayOrderNumber}` : 'New order'}
            </h2>
          </div>
          <p className="current-order-cashier">
            <span>Cashier</span>
            <strong>{order?.cashierNameSnapshot ?? (order ? 'No cashier' : 'Set on first item')}</strong>
          </p>
        </header>

        <div className="current-order-details">
          <label className="order-field" htmlFor="order-customer-name">
            <span>Customer name (optional)</span>
            <input
              id="order-customer-name"
              value={customerName}
              maxLength={255}
              placeholder="Walk-in"
              disabled={pendingAction === 'order-header'}
              onChange={(event) => setCustomerName(event.target.value)}
              onBlur={() => void saveCustomerName()}
            />
          </label>
          <fieldset className="order-service-type">
            <legend>Order type</legend>
            <div>
              <button
                type="button"
                aria-pressed={serviceType === ServiceType.DINE_IN}
                disabled={pendingAction === 'order-header'}
                onClick={() => void chooseServiceType(ServiceType.DINE_IN)}
              >
                Dine-in
              </button>
              <button
                type="button"
                aria-pressed={serviceType === ServiceType.TAKE_OUT}
                disabled={pendingAction === 'order-header'}
                onClick={() => void chooseServiceType(ServiceType.TAKE_OUT)}
              >
                Take-out
              </button>
            </div>
          </fieldset>
        </div>

        <div className="current-order-lines">
          {!order || order.lines.length === 0 ? (
            <div className="current-order-empty">
              <strong>Order is empty</strong>
              <span>Choose a product size to begin.</span>
            </div>
          ) : (
            order.lines.map((line) => {
              const decrementWouldInvalidateUpsize =
                line.quantity > 1 && line.freeUpsizeCount >= line.quantity;
              return (
                <article className="current-order-line" key={line.id}>
                  <div className="current-order-line-main">
                    <div>
                      <h3>{line.productNameSnapshot}</h3>
                      <p>
                        {line.variantNameSnapshot} · {formatPeso(line.unitPriceCents)} each
                      </p>
                    </div>
                    <strong>{formatPeso(line.lineTotalCents)}</strong>
                  </div>
                  <div className="current-order-line-details">
                    {line.preferences.map((preference) => (
                      <span key={preference}>{PREFERENCE_LABELS[preference]}</span>
                    ))}
                    {line.freeUpsizeCount > 0 && (
                      <span className="is-promotion">
                        {line.freeUpsizeCount} free upsize{line.freeUpsizeCount === 1 ? '' : 's'} · {deduction(line.freeUpsizeCents)}
                      </span>
                    )}
                    {line.discountKind !== LineDiscountKind.NONE && (
                      <span className="is-discount">
                        {DISCOUNT_LABELS[line.discountKind]} · {deduction(line.discountCents)}
                      </span>
                    )}
                    {line.preferenceNote && (
                      <p><strong>Note:</strong> {line.preferenceNote}</p>
                    )}
                  </div>
                  <div className="current-order-line-actions" aria-label={`Controls for ${lineName(line)}`}>
                    <button
                      type="button"
                      aria-label={`Decrease ${line.productNameSnapshot} quantity`}
                      aria-describedby={decrementWouldInvalidateUpsize ? `decrement-help-${line.id}` : undefined}
                      disabled={pendingAction !== null || decrementWouldInvalidateUpsize}
                      onClick={() => void changeLine('decrement', line)}
                    >
                      −
                    </button>
                    <output aria-label={`Quantity ${line.quantity}`}>{line.quantity}</output>
                    <button
                      type="button"
                      aria-label={`Increase ${line.productNameSnapshot} quantity`}
                      disabled={pendingAction !== null}
                      onClick={() => void changeLine('increment', line)}
                    >
                      +
                    </button>
                    <button type="button" disabled={pendingAction !== null} onClick={() => setEditor({ kind: 'preferences', lineId: line.id })}>
                      Preferences
                    </button>
                    <button type="button" disabled={pendingAction !== null} onClick={() => setEditor({ kind: 'discount', lineId: line.id })}>
                      Discount
                    </button>
                    <button
                      type="button"
                      className="is-promotion"
                      disabled={pendingAction !== null || !line.freeUpsizeEligible}
                      aria-describedby={!line.freeUpsizeEligible ? `upsize-help-${line.id}` : undefined}
                      onClick={() => setEditor({ kind: 'upsize', lineId: line.id })}
                    >
                      Free upsize
                    </button>
                    <button
                      type="button"
                      className="is-remove"
                      aria-label={`Remove ${line.productNameSnapshot}`}
                      disabled={pendingAction !== null}
                      onClick={() => void changeLine('remove', line)}
                    >
                      Remove
                    </button>
                    {decrementWouldInvalidateUpsize && (
                      <span id={`decrement-help-${line.id}`} className="sr-only">
                        Reduce the free upsize count before reducing quantity.
                      </span>
                    )}
                    {!line.freeUpsizeEligible && (
                      <span id={`upsize-help-${line.id}`} className="sr-only">
                        This line is not eligible for the free upsize promotion.
                      </span>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <dl className="current-order-totals" aria-live="polite">
          <div><dt>Pre-discount subtotal</dt><dd>{formatPeso(order?.subtotalCents ?? 0)}</dd></div>
          <div className="is-promotion"><dt>Free upsize</dt><dd>{deduction(order?.freeUpsizeCents ?? 0)}</dd></div>
          <div className="is-discount"><dt>Line discounts</dt><dd>{deduction(order?.discountCents ?? 0)}</dd></div>
          <div className="is-due"><dt>Amount due</dt><dd>{formatPeso(order?.totalCents ?? 0)}</dd></div>
        </dl>

        <div className="current-order-actions">
          <button type="button" disabled={pendingAction !== null} onClick={() => void parkCurrentOrder()}>
            {order ? 'Park order' : 'Discard empty order'}
          </button>
        </div>

        {otherParkedOrders.length > 0 && (
          <section className="parked-orders" aria-labelledby="parked-orders-title">
            <header>
              <h3 id="parked-orders-title">Parked orders</h3>
              <span>{otherParkedOrders.length}</span>
            </header>
            <ul>
              {otherParkedOrders.map((parkedOrder) => (
                <li key={parkedOrder.id}>
                  <div>
                    <strong>#{parkedOrder.dayOrderNumber} · {parkedOrder.customerName ?? 'Walk-in'}</strong>
                    <span>
                      {parkedOrder.serviceType === ServiceType.DINE_IN ? 'Dine-in' : 'Take-out'} · {itemCount(parkedOrder)} item{itemCount(parkedOrder) === 1 ? '' : 's'} · {formatPeso(parkedOrder.totalCents)}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={pendingAction !== null || order !== null}
                    title={order ? 'Park the current order before resuming another.' : undefined}
                    onClick={() => resumeOrder(parkedOrder)}
                  >
                    Resume
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>

      {editor && activeEditorLine && (
        <LineEditor
          key={`${editor.kind}-${editor.lineId}`}
          kind={editor.kind}
          line={activeEditorLine}
          isSaving={pendingAction === 'line-editor'}
          onClose={() => setEditor(null)}
          onSave={saveLineEditor}
        />
      )}
    </main>
  );
}
