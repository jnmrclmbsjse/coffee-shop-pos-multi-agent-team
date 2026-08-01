/* Cross-screen consistency reference — issue #174 / design task #176
 *
 * Reference chrome only. Two switches:
 *   1. viewport  — resizes both shell frames to 1024x768 or 390x844
 *   2. dayState  — flips the business-day prerequisite so the strip can be
 *                  inspected in both its available and unavailable states
 *
 * The availability rules below are a demonstration of the CONTRACT, not a
 * specification of business prerequisites. The real prerequisites live in the
 * trading-day domain and are unchanged by this document.
 */

(function () {
  'use strict';

  var VIEWPORTS = {
    tablet: { w: '1024px', h: '768px', label: '1024 × 768' },
    narrow: { w: '390px', h: '844px', label: '390 × 844' },
  };

  var LOCK_SVG =
    '<svg viewBox="0 0 24 24">' +
    '<path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/>' +
    '<path d="M7 10h10a1 1 0 0 1 1 1v8H6v-8a1 1 0 0 1 1-1Z"/>' +
    '</svg>';

  var REASON = {
    dayOpen: 'unavailable, open the business day first',
    dayClosed: 'unavailable, a business day is already open',
  };

  var frames = document.querySelectorAll('[data-frame]');
  var nav = document.querySelector('[data-staff-nav]');
  var dayContext = document.querySelector('[data-day-context]');
  var dayPrimary = document.querySelector('[data-day-primary]');
  var daySecondary = document.querySelector('[data-day-secondary]');
  var staffBody = document.querySelector('[data-staff-body]');
  var staffBlocking = document.querySelector('[data-staff-blocking]');
  var items = nav ? nav.querySelectorAll('.s-item') : [];

  /* ------------------------------- viewport ------------------------------ */

  function applyViewport(key) {
    var vp = VIEWPORTS[key] || VIEWPORTS.tablet;
    Array.prototype.forEach.call(frames, function (frame) {
      frame.style.setProperty('--frame-w', vp.w);
      frame.style.setProperty('--frame-h', vp.h);
      var size = frame.querySelector('[data-frame-size]');
      if (size) size.textContent = vp.label;
    });
  }

  /* ------------------------------ nav states ----------------------------- */

  function isAvailable(needs, dayOpen) {
    if (needs === 'always') return true;
    if (needs === 'dayClosed') return !dayOpen;
    return dayOpen;
  }

  function setItemState(item, available, current, reasonKey) {
    var label = item.querySelector('.s-item-label');
    var base = label ? label.textContent.trim() : '';
    var lock = item.querySelector('.s-item-lock');

    item.classList.toggle('is-unavailable', !available);
    item.classList.toggle('is-current', available && current);

    if (available) {
      /* Actionable: real anchor, in tab order, activation navigates. */
      item.setAttribute('href', '#');
      item.removeAttribute('role');
      item.removeAttribute('aria-disabled');
      if (lock) lock.remove();
      if (current) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
      var extra = item.querySelector('.vh');
      if (extra) extra.remove();
      return;
    }

    /* Unavailable: href removed, so the element is neither focusable by Tab
       nor activatable, while role + aria-disabled keep it announced. */
    item.removeAttribute('href');
    item.removeAttribute('aria-current');
    item.setAttribute('role', 'link');
    item.setAttribute('aria-disabled', 'true');

    if (!lock) {
      var mark = document.createElement('span');
      mark.className = 's-item-lock';
      mark.setAttribute('aria-hidden', 'true');
      mark.innerHTML = LOCK_SVG;
      item.insertBefore(mark, item.firstChild);
    }

    if (!item.querySelector('.vh')) {
      var sr = document.createElement('span');
      sr.className = 'vh';
      sr.textContent = ', ' + (REASON[reasonKey] || 'unavailable');
      item.appendChild(sr);
    }

    void base;
  }

  function applyDayState(state) {
    var dayOpen = state !== 'closed';

    /* Business-day context never disappears. It changes wording only. */
    if (dayContext) {
      dayContext.setAttribute('data-state', dayOpen ? 'open' : 'closed');
    }
    if (dayPrimary) {
      dayPrimary.textContent = dayOpen
        ? 'Tue 14 Oct 2025'
        : 'No business day open';
    }
    if (daySecondary) {
      daySecondary.textContent = dayOpen
        ? 'Peak day · open'
        : 'Open a day to record sales';
    }

    var currentDest = dayOpen ? 'restock' : 'open-day';

    Array.prototype.forEach.call(items, function (item) {
      var needs = item.getAttribute('data-needs') || 'dayOpen';
      var dest = item.getAttribute('data-dest');
      setItemState(
        item,
        isAvailable(needs, dayOpen),
        dest === currentDest,
        needs,
      );
    });

    /* Frame label follows the current route so the strip and the route agree. */
    var staffFrame = document.querySelector('[data-od-id="staff-frame"]');
    if (staffFrame) {
      var spans = staffFrame.querySelectorAll('.frame-label span');
      if (spans.length > 1) {
        spans[1].textContent = dayOpen ? '/pos/restock' : '/pos/open';
      }
    }

    if (staffBody) staffBody.hidden = !dayOpen;
    if (staffBlocking) staffBlocking.hidden = dayOpen;
  }

  /* ------------------------------- wiring -------------------------------- */

  document.addEventListener('change', function (event) {
    var target = event.target;
    if (!target || target.type !== 'radio') return;
    if (target.name === 'viewport') applyViewport(target.value);
    if (target.name === 'dayState') applyDayState(target.value);
  });

  /* Demo links must not navigate away from the reference. */
  document.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('a[href="#"]') : null;
    if (link) event.preventDefault();
  });

  applyViewport('tablet');
  applyDayState('open');
})();
