(function () {
  'use strict';

  const STORAGE_KEY = 'ucm.pos.nav-visible.v1';
  const root = document.documentElement;
  const header = document.getElementById('staff-header');
  const chrome = document.getElementById('staff-workspace-chrome');
  const toggle = document.getElementById('menu-toggle');
  const main = document.getElementById('staff-main');
  const track = document.getElementById('content-track');
  const select = document.getElementById('screen-select');
  const measurements = document.getElementById('measurements');
  const checks = document.getElementById('geometry-checks');
  const toast = document.getElementById('toast');

  const products = [
    ['Espresso', 'Hot coffee', 120], ['Americano', 'Hot coffee', 135],
    ['Flat White', 'Milk coffee', 165], ['Cappuccino', 'Milk coffee', 165],
    ['Cafe Latte', 'Milk coffee', 175], ['Mocha', 'Milk coffee', 185],
    ['Cold Brew', 'Cold coffee', 155], ['Iced Latte', 'Cold coffee', 180],
    ['Matcha Latte', 'Non-coffee', 190], ['Chocolate', 'Non-coffee', 170],
    ['Croissant', 'Pastry', 105], ['Banana Bread', 'Pastry', 115]
  ];

  let currentScreen = 'order';
  let order = [
    { name: 'Flat White', detail: 'Oat milk', price: 185, qty: 1 },
    { name: 'Croissant', detail: 'Warmed', price: 105, qty: 1 },
    { name: 'Americano', detail: 'Regular', price: 135, qty: 2 },
    { name: 'Banana Bread', detail: '1 slice', price: 115, qty: 1 }
  ];
  let references = {};
  let lastState = null;
  let completedCycles = 0;
  let toastTimer;

  function readPreference() {
    try { return localStorage.getItem(STORAGE_KEY) !== 'false'; }
    catch (_) { return root.dataset.navVisible !== 'false'; }
  }

  function setMenuVisible(visible, persist) {
    chrome.hidden = !visible;
    root.dataset.navVisible = String(visible);
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.textContent = visible ? 'Hide menu' : 'Show menu';
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, String(visible)); } catch (_) {}
    }
    const state = visible ? 'shown' : 'hidden';
    if (lastState === 'hidden' && state === 'shown') completedCycles += 1;
    lastState = state;
    requestAnimationFrame(updateMeasurements);
  }

  function money(value) {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(value);
  }

  function productMarkup() {
    return products.map((product, index) => `
      <button class="product-card" type="button" data-product-index="${index}" data-od-id="product-${index}">
        <span>${product[1]}</span><strong>${product[0]}</strong><span class="price">${money(product[2])}</span>
      </button>`).join('');
  }

  function orderMarkup() {
    return order.map((item, index) => `
      <div class="order-line${index === order.length - 1 ? ' final-scroll-target' : ''}" data-order-index="${index}" data-od-id="order-line-${index}">
        <div class="order-line-name"><strong>${item.name}</strong><span>${item.detail}</span></div>
        <div class="stepper" aria-label="Quantity for ${item.name}">
          <button type="button" data-step="-1" aria-label="Decrease ${item.name}">−</button>
          <span>${item.qty}</span>
          <button type="button" data-step="1" aria-label="Increase ${item.name}">+</button>
        </div>
        <strong class="line-total">${money(item.price * item.qty)}</strong>
      </div>`).join('');
  }

  function orderTotal() { return order.reduce((sum, item) => sum + item.price * item.qty, 0); }

  function renderOrder() {
    main.innerHTML = `
      <section class="take-order-page operational-area" data-od-id="take-order-page">
        <section class="catalog-pane" aria-labelledby="catalog-title" data-od-id="catalog-pane">
          <div class="pane-heading"><h1 id="catalog-title">Take Order</h1><p>Select an item to add it to the current order.</p></div>
          <div class="category-strip" aria-label="Product categories">
            <button class="category-chip is-active" type="button">All</button>
            <button class="category-chip" type="button">Coffee</button>
            <button class="category-chip" type="button">Cold</button>
            <button class="category-chip" type="button">Food</button>
          </div>
          <div class="product-grid" data-od-id="product-grid">${productMarkup()}</div>
        </section>
        <section class="order-pane" aria-labelledby="order-title" data-od-id="current-order-pane">
          <div class="pane-heading"><h2 id="order-title">Current order</h2><p>Dine in · Front counter</p></div>
          <div class="order-list" id="order-list">${orderMarkup()}</div>
          <footer class="order-footer" data-od-id="order-action-footer">
            <div class="running-total"><span>Total</span><strong id="order-total">${money(orderTotal())}</strong></div>
            <button class="button button-primary" type="button" id="charge-order">Charge / Place order</button>
          </footer>
        </section>
      </section>`;
  }

  function renderState(kind) {
    const error = kind === 'error';
    main.innerHTML = `
      <section class="take-order-state operational-area" data-od-id="take-order-${kind}-state">
        <div class="state-card${error ? ' error' : ''}">
          <h1>${error ? 'Could not load Take Order' : 'No business day open'}</h1>
          <p>${error ? 'The menu and register data did not load. Check the connection, then try again.' : 'Open a business day before taking orders at this register.'}</p>
          <button class="button ${error ? 'button-secondary' : 'button-primary'}" type="button" id="state-action">${error ? 'Try again' : 'Go to Trading Day'}</button>
        </div>
      </section>`;
  }

  function orderRows(short) {
    const rows = [
      ['#1048', '10:42 AM', 'Mara', 'Card', 'Paid', 455],
      ['#1047', '10:35 AM', 'Paolo', 'Cash', 'Paid', 285],
      ['#1046', '10:28 AM', 'Mara', 'Card', 'Refunded', 175],
      ['#1045', '10:16 AM', 'Mara', 'Cash', 'Paid', 620],
      ['#1044', '10:08 AM', 'Paolo', 'Card', 'Paid', 350],
      ['#1043', '9:56 AM', 'Mara', 'Cash', 'Paid', 270],
      ['#1042', '9:48 AM', 'Paolo', 'Card', 'Paid', 515],
      ['#1041', '9:37 AM', 'Mara', 'Cash', 'Paid', 405],
      ['#1040', '9:24 AM', 'Paolo', 'Card', 'Paid', 330]
    ];
    return (short ? rows.slice(0, 2) : rows).map((row, index, shown) => `
      <tr${index === shown.length - 1 ? ' class="final-scroll-target"' : ''}>
        <td><strong>${row[0]}</strong></td><td>${row[1]}</td><td>${row[2]}</td><td>${row[3]}</td>
        <td><span class="status-text">${row[4]}</span></td><td>${money(row[5])}</td>
      </tr>`).join('');
  }

  function renderHistory(short) {
    main.innerHTML = `
      <section class="flow-page" data-od-id="order-history-page">
        <div class="flow-inner operational-area">
          <header class="flow-header"><h1>Order History${short ? ' - short content' : ''}</h1><p>Review transactions without forcing a short result set to fill the viewport.</p></header>
          <form class="filter-row" id="history-filter">
            <div class="field"><label for="history-date">Business date</label><input id="history-date" type="date" value="2026-08-22"></div>
            <div class="field"><label for="history-status">Status</label><select id="history-status"><option>All statuses</option><option>Paid</option><option>Refunded</option></select></div>
            <div class="field"><label for="history-search">Order or cashier</label><input id="history-search" type="search" placeholder="Search orders"></div>
            <button class="button button-secondary" type="submit">Apply filters</button>
          </form>
          <div class="table-wrap"><table><thead><tr><th>Order</th><th>Time</th><th>Cashier</th><th>Payment</th><th>Status</th><th>Total</th></tr></thead>
            <tbody>${orderRows(short)}</tbody></table></div>
        </div>
      </section>`;
  }

  function renderOperationalForm(kind) {
    const configs = {
      stock: {
        title: 'Stock Counts', intro: 'Record the closing count for a product group.',
        fields: `<div class="field"><label for="stock-location">Location</label><select id="stock-location"><option>Front bar</option><option>Back room</option></select></div><div class="field"><label for="stock-count">Coffee beans on hand</label><input id="stock-count" type="number" inputmode="decimal" value="12" min="0"></div>`,
        action: 'Complete stock count'
      },
      cash: {
        title: 'Cash & Expenses', intro: 'Record a cash movement against the open business day.',
        fields: `<div class="field"><label for="cash-type">Entry type</label><select id="cash-type"><option>Expense</option><option>Cash in</option></select></div><div class="field"><label for="cash-amount">Amount</label><input id="cash-amount" type="number" inputmode="decimal" value="250" min="0"></div><div class="field"><label for="cash-note">Note</label><input id="cash-note" type="text" value="Milk delivery"></div>`,
        action: 'Submit entry'
      },
      trading: {
        title: 'Trading Day', intro: 'Manage the current business day for this location.',
        fields: `<div class="short-note"><strong>Business day is open</strong><p>Opened today at 7:01 AM by Mara Santos.</p></div>`,
        action: 'Close business day', danger: true
      }
    };
    const item = configs[kind];
    main.innerHTML = `
      <section class="flow-page" data-od-id="${kind}-page">
        <div class="flow-inner operational-area">
          <header class="flow-header"><h1>${item.title}</h1><p>${item.intro}</p></header>
          <form class="operational-form" id="operational-form">${item.fields}
            <button class="button ${item.danger ? 'button-danger' : 'button-primary'} final-scroll-target" type="submit">${item.action}</button>
          </form>
        </div>
      </section>`;
  }

  function renderScreen(screen) {
    currentScreen = screen;
    select.value = screen;
    if (screen === 'order') renderOrder();
    else if (screen === 'closed' || screen === 'error') renderState(screen);
    else if (screen === 'history' || screen === 'history-short') renderHistory(screen === 'history-short');
    else renderOperationalForm(screen);
    document.querySelectorAll('.nav-link').forEach((button) => {
      const activeScreen = screen.startsWith('history') ? 'history' : screen;
      button.classList.toggle('is-active', button.dataset.screen === activeScreen);
    });
    main.focus({ preventScroll: true });
    requestAnimationFrame(updateMeasurements);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2200);
  }

  function currentGeometry() {
    const headerRect = header.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const area = main.querySelector('.operational-area') || main;
    const areaRect = area.getBoundingClientRect();
    return {
      state: chrome.hidden ? 'hidden' : 'shown',
      headerHeight: headerRect.height,
      headerBottom: headerRect.bottom,
      trackTop: trackRect.top,
      trackHeight: trackRect.height,
      viewportHeight: window.innerHeight,
      areaTop: areaRect.top,
      areaHeight: areaRect.height,
      bottomGap: window.innerHeight - areaRect.bottom
    };
  }

  function within(value, target) { return Math.abs(value - target) <= 2; }
  function px(value) { return `${value.toFixed(1)} px`; }
  function checkRow(label, result, waiting) {
    const state = waiting ? 'wait' : result ? 'pass' : 'fail';
    return `<div class="check"><span>${label}</span><strong class="check-${state}">${waiting ? 'NEEDS BOTH STATES' : result ? 'PASS' : 'CHECK'}</strong></div>`;
  }

  function updateMeasurements() {
    const geometry = currentGeometry();
    const desktop = window.innerWidth > 767;
    if (!references[currentScreen]) references[currentScreen] = { shown: null, hidden: null };
    const screenReferences = references[currentScreen];
    if (!screenReferences[geometry.state]) screenReferences[geometry.state] = { ...geometry };
    const shown = screenReferences.shown;
    const hidden = screenReferences.hidden;
    const delta = shown && hidden ? shown.headerHeight - hidden.headerHeight : null;
    const areaGrowth = shown && hidden ? hidden.areaHeight - shown.areaHeight : null;
    const flowShift = shown && hidden ? shown.areaTop - hidden.areaTop : null;
    const ref = screenReferences[geometry.state];
    const drift = Math.max(
      Math.abs(geometry.headerHeight - ref.headerHeight),
      Math.abs(geometry.areaTop - ref.areaTop),
      Math.abs(geometry.areaHeight - ref.areaHeight)
    );
    const fitted = ['order', 'closed', 'error'].includes(currentScreen);

    measurements.innerHTML = `
      <div><dt>Menu state</dt><dd>${geometry.state}</dd></div>
      <div><dt>Header height</dt><dd>${px(geometry.headerHeight)}</dd></div>
      <div><dt>Content-track top</dt><dd>${px(geometry.trackTop)}</dd></div>
      <div><dt>Content-track height</dt><dd>${px(geometry.trackHeight)}</dd></div>
      <div><dt>Viewport height</dt><dd>${px(geometry.viewportHeight)}</dd></div>
      <div><dt>Operational bottom gap</dt><dd>${px(geometry.bottomGap)}</dd></div>
      <div><dt>Header delta</dt><dd>${delta === null ? 'Toggle once' : px(delta)}</dd></div>
      <div><dt>Area growth</dt><dd>${areaGrowth === null ? 'Toggle once' : px(areaGrowth)}</dd></div>
      <div><dt>Completed cycles</dt><dd>${completedCycles}</dd></div>
      <div><dt>Max drift vs first state</dt><dd>${px(drift)}</dd></div>`;

    checks.innerHTML = [
      checkRow('Track begins after header', within(geometry.trackTop, geometry.headerBottom), false),
      checkRow('Fitted bottom within 2px', !desktop || !fitted || within(geometry.bottomGap, 0), false),
      checkRow('Area growth equals header delta', delta !== null && areaGrowth !== null && within(areaGrowth, delta), delta === null || !fitted),
      checkRow('Flow shift equals header delta', delta !== null && flowShift !== null && within(flowShift, delta), delta === null || fitted),
      checkRow('Current state drift within 2px', within(drift, 0), false)
    ].join('');
  }

  toggle.addEventListener('click', () => setMenuVisible(chrome.hidden, true));
  select.addEventListener('change', () => renderScreen(select.value));
  document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', () => renderScreen(button.dataset.screen)));

  main.addEventListener('click', (event) => {
    const productButton = event.target.closest('[data-product-index]');
    if (productButton) {
      const product = products[Number(productButton.dataset.productIndex)];
      const existing = order.find((item) => item.name === product[0] && item.detail === 'Regular');
      if (existing) existing.qty += 1;
      else order.push({ name: product[0], detail: 'Regular', price: product[2], qty: 1 });
      renderOrder();
      requestAnimationFrame(() => {
        if (window.innerWidth > 767) {
          const list = document.getElementById('order-list');
          list.scrollTop = list.scrollHeight;
        }
      });
      return;
    }
    const stepButton = event.target.closest('[data-step]');
    if (stepButton) {
      const line = stepButton.closest('[data-order-index]');
      const index = Number(line.dataset.orderIndex);
      order[index].qty += Number(stepButton.dataset.step);
      if (order[index].qty <= 0) order.splice(index, 1);
      renderOrder();
      return;
    }
    if (event.target.id === 'charge-order') showToast(`Order ready to charge: ${money(orderTotal())}`);
    if (event.target.id === 'state-action') {
      if (currentScreen === 'closed') renderScreen('trading');
      else renderScreen('order');
    }
  });

  main.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.id === 'history-filter') showToast('Filters applied');
    else showToast('Action recorded in the mockup');
  });

  document.getElementById('dismiss-inspector').addEventListener('click', () => {
    document.getElementById('mockup-inspector').hidden = true;
    document.getElementById('reopen-inspector').hidden = false;
  });
  document.getElementById('reopen-inspector').addEventListener('click', () => {
    document.getElementById('mockup-inspector').hidden = false;
    document.getElementById('reopen-inspector').hidden = true;
  });
  document.getElementById('reset-geometry').addEventListener('click', () => {
    references = {};
    completedCycles = 0;
    updateMeasurements();
  });
  document.getElementById('sign-out').addEventListener('click', () => showToast('Sign out is not connected in this mockup'));
  document.getElementById('cashier-action').addEventListener('click', () => showToast('Cashier controls remain in the collapsible chrome'));

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => requestAnimationFrame(updateMeasurements));
    observer.observe(header);
    observer.observe(track);
  }
  window.addEventListener('resize', updateMeasurements, { passive: true });

  setMenuVisible(readPreference(), false);
  renderScreen('order');
})();
