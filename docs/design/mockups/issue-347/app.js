(function () {
  "use strict";

  const states = [
    ["roster", "Roster"],
    ["dialog-empty", "Dialog: empty"],
    ["dialog-password", "Dialog: typing password only"],
    ["dialog-pin", "Dialog: typing PIN only"],
    ["dialog-first-pin", "Dialog: no PIN yet (first-PIN warning)"],
    ["dialog-password-error", "Dialog: password error"],
    ["dialog-pin-error", "Dialog: PIN error"],
    ["dialog-nothing-error", "Dialog: nothing entered error"],
    ["dialog-saving", "Dialog: saving"],
    ["success-password", "Success: password only"],
    ["success-pin", "Success: PIN only"],
    ["success-both", "Success: both"],
    ["success-first-pin", "Success: first PIN set"],
    ["refusal-no-account", "Refusal: no login account"],
    ["refusal-not-found", "Refusal: staff not found"],
    ["refusal-generic", "Refusal: generic failure"]
  ];

  const modalRoot = document.getElementById("modal-root");
  const stateButtons = document.getElementById("state-buttons");
  const appShell = document.querySelector(".app-shell");
  let currentState = "roster";
  let lastTrigger = null;
  let activeMember = { name: "Mara Villanueva", username: "mara.v", hasPin: true };

  states.forEach(([id, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "state-button";
    button.dataset.state = id;
    button.textContent = label;
    button.setAttribute("aria-pressed", id === "roster" ? "true" : "false");
    button.addEventListener("click", () => {
      lastTrigger = button;
      activeMember = id.includes("first-pin")
        ? { name: "Josefina Pilar Manalastas-Bautista", username: "josefina.mb", hasPin: false }
        : id === "refusal-no-account"
          ? { name: "Paolo Reyes", username: "No login account", hasPin: false }
          : { name: "Mara Villanueva", username: "mara.v", hasPin: true };
      showState(id);
    });
    stateButtons.appendChild(button);
  });

  document.querySelectorAll(".manage-account").forEach((button) => {
    button.addEventListener("click", () => {
      lastTrigger = button;
      activeMember = {
        name: button.dataset.member,
        username: button.dataset.username,
        hasPin: button.dataset.state !== "dialog-first-pin"
      };
      showState(button.dataset.state);
    });
  });

  document.getElementById("picker-toggle").addEventListener("click", (event) => {
    const picker = document.querySelector(".state-picker");
    const collapsed = picker.classList.toggle("is-collapsed");
    event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    event.currentTarget.textContent = collapsed ? "Show" : "Hide";
  });

  function showState(id) {
    currentState = id;
    document.querySelectorAll(".state-button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.state === id));
    });

    if (id === "roster") {
      closeDialog(true);
      return;
    }

    appShell.setAttribute("aria-hidden", "true");
    modalRoot.innerHTML = buildDialog(id);
    bindDialog(id);
    window.setTimeout(() => {
      const dialog = modalRoot.querySelector(".dialog");
      const first = modalRoot.querySelector(id.startsWith("dialog-") ? "#new-password:not([disabled])" : ".dialog button:not([disabled])");
      if (first) first.focus();
      else if (dialog) dialog.focus();
    }, 0);
  }

  function buildDialog(id) {
    const isForm = id.startsWith("dialog-");
    const saving = id === "dialog-saving";
    const firstPin = id === "dialog-first-pin";
    const passwordError = id === "dialog-password-error";
    const pinError = id === "dialog-pin-error";
    const nothingError = id === "dialog-nothing-error";
    const passwordValue = id === "dialog-password" || saving ? "  bagong passphrase  " : "";
    const pinValue = id === "dialog-pin" ? "4829" : pinError ? "48A" : firstPin ? "" : saving ? "4829" : "";

    if (!isForm) return panelDialog(id);

    const errorItems = [
      passwordError ? '<li><a href="#new-password">Enter a new password.</a></li>' : "",
      pinError ? '<li><a href="#new-pin">Enter a PIN using exactly four digits.</a></li>' : "",
      nothingError ? '<li><a href="#new-password">Enter a new password, a new PIN, or both.</a></li>' : ""
    ].join("");
    const notice = errorItems ? `<div class="notice" role="alert" data-od-id="validation-notice"><strong>Notice</strong><p>Check the following before saving:</p><ul>${errorItems}</ul></div>` : "";
    const description = `Replace credentials for <strong>${activeMember.name}</strong>. Login account: <strong>${activeMember.username}</strong>.`;

    return `<div class="modal-layer">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-description" tabindex="-1" data-od-id="credential-dialog">
        <div class="dialog__head">
          <div><h2 id="dialog-title">Replace password or PIN</h2><p id="dialog-description">${description}</p></div>
          <button class="button button--secondary close-button" type="button" data-close ${saving ? "disabled" : ""}>Close</button>
        </div>
        ${notice}
        <form id="credential-form" novalidate>
          <div class="field-group">
            <label for="new-password">New password</label>
            <div class="password-row">
              <input id="new-password" name="new-password" type="password" autocomplete="new-password" value="${passwordValue}" ${passwordError || nothingError ? 'aria-invalid="true"' : ""} aria-describedby="password-help password-state${passwordError || nothingError ? " password-error" : ""}" ${saving ? "disabled" : ""}>
              <button class="button button--secondary reveal-button" type="button" data-reveal="new-password" aria-label="Show new password" ${saving ? "disabled" : ""}>Show</button>
            </div>
            <p class="help" id="password-help">Leave blank to keep the password unchanged. A new password must contain at least 1 character. Spaces, including leading, trailing, or whitespace-only characters, are preserved exactly and are not trimmed.</p>
            ${passwordError ? '<p class="error" id="password-error">Enter a new password with at least 1 character.</p>' : nothingError ? '<p class="error" id="password-error">Enter a new password here or enter a new PIN below.</p>' : ""}
            <p class="credential-state" id="password-state" data-state-line="password"><strong>Password:</strong> ${passwordValue ? "new value entered - will be replaced" : "will not change"}</p>
          </div>
          <div class="field-group">
            <label for="new-pin">New PIN</label>
            <div class="password-row">
              <input id="new-pin" name="new-pin" type="password" inputmode="numeric" autocomplete="new-password" value="${pinValue}" ${pinError || nothingError ? 'aria-invalid="true"' : ""} aria-describedby="pin-help pin-state${pinError || nothingError ? " pin-error" : ""}" ${saving ? "disabled" : ""}>
              <button class="button button--secondary reveal-button" type="button" data-reveal="new-pin" aria-label="Show new PIN" ${saving ? "disabled" : ""}>Show</button>
            </div>
            <p class="help" id="pin-help">${firstPin ? "No PIN is set. Leave blank to keep this account without a PIN, or enter exactly four digits from 0 to 9 to set one." : "Leave blank to keep the PIN unchanged. To replace it, enter exactly four digits from 0 to 9."}</p>
            ${pinError ? '<p class="error" id="pin-error">Enter exactly four digits using 0 to 9 only.</p>' : nothingError ? '<p class="error" id="pin-error">Enter a new PIN here or enter a new password above.</p>' : ""}
            <p class="credential-state" id="pin-state" data-state-line="pin"><strong>PIN:</strong> ${firstPin ? "not set - will remain not set" : pinValue ? "new value entered - will be replaced" : "currently set - will not change"}</p>
          </div>
          ${firstPin ? '<div class="first-pin-warning"><strong>Setting a PIN for the first time</strong><span>After a PIN is set, Josefina will be asked for it whenever she is selected as the active cashier at the register.</span></div>' : ""}
          <div class="dialog__actions">
            <button class="button button--secondary" type="button" data-close ${saving ? "disabled" : ""}>Cancel</button>
            <button class="button button--primary" type="submit" ${saving ? "disabled" : ""}>${saving ? "Saving changes..." : "Save credential changes"}</button>
          </div>
        </form>
      </section>
    </div>`;
  }

  function panelDialog(id) {
    const panels = {
      "success-password": ["success", "Password replaced", "Mara Villanueva's password was replaced for account mara.v. The new password is active for future sign-ins."],
      "success-pin": ["success", "PIN replaced", "Mara Villanueva's PIN was replaced for account mara.v. The new PIN is active for future cashier selection."],
      "success-both": ["success", "Password and PIN replaced", "Mara Villanueva's password and PIN were replaced for account mara.v. The new credentials are active for future use."],
      "success-first-pin": ["success", "PIN set for the first time", "Josefina Pilar Manalastas-Bautista now has a PIN for account josefina.mb. She will be asked for it when selected as the active cashier."],
      "refusal-no-account": ["danger", "No login account", "No credentials were changed. Paolo Reyes does not have a login account, so there is no password or PIN to replace. Any existing staff record is unchanged.", "409"],
      "refusal-not-found": ["danger", "Staff member not found", "No credentials were changed. This staff member no longer exists. If an old login account is still shown elsewhere, refresh the staff list before trying again.", "404"],
      "refusal-generic": ["danger", "Credential changes could not be saved", "Nothing changed. The previous password and PIN still work. Try again. If the problem continues, contact the system administrator."]
    };
    const [kind, title, message, code] = panels[id];
    const isSuccess = kind === "success";
    return `<div class="modal-layer">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-description" tabindex="-1" data-od-id="credential-result-dialog">
        <div class="dialog__head">
          <div><h2 id="dialog-title">Credential replacement</h2><p id="dialog-description">Result for <strong>${activeMember.name}</strong>${activeMember.username !== "No login account" ? `, account <strong>${activeMember.username}</strong>` : ""}.</p></div>
          <button class="button button--secondary close-button" type="button" data-close>Close</button>
        </div>
        <div class="status-panel status-panel--${kind}" ${isSuccess ? 'role="status" aria-live="polite"' : 'role="alert"'} data-od-id="credential-result-panel">
          ${code ? `<span class="status-code">HTTP ${code}</span>` : ""}<h3>${title}</h3><p>${message}</p>
          ${isSuccess ? '<p>Sessions already signed in are not ended. They continue until logout or the existing 8-hour session expiry.</p>' : '<p>The old credentials still work.</p>'}
        </div>
        <div class="dialog__actions">
          ${id === "refusal-generic" ? '<button class="button button--secondary" type="button" data-retry>Try again</button>' : ""}
          <button class="button button--primary" type="button" data-close>${isSuccess ? "Done" : "Back to staff"}</button>
        </div>
      </section>
    </div>`;
  }

  function bindDialog(id) {
    modalRoot.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog()));
    modalRoot.querySelectorAll("[data-reveal]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.reveal);
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        button.textContent = showing ? "Show" : "Hide";
        button.setAttribute("aria-label", `${showing ? "Show" : "Hide"} ${button.dataset.reveal === "new-pin" ? "new PIN" : "new password"}`);
        input.focus();
      });
    });
    const form = document.getElementById("credential-form");
    if (form) {
      form.addEventListener("input", updateCredentialStates);
      form.addEventListener("submit", handleSubmit);
    }
    const retry = modalRoot.querySelector("[data-retry]");
    if (retry) retry.addEventListener("click", () => showState("dialog-empty"));
    document.addEventListener("keydown", trapDialogFocus);
  }

  function updateCredentialStates() {
    const password = document.getElementById("new-password");
    const pin = document.getElementById("new-pin");
    if (!password || !pin) return;
    document.querySelector('[data-state-line="password"]').innerHTML = `<strong>Password:</strong> ${password.value.length ? "new value entered - will be replaced" : "will not change"}`;
    document.querySelector('[data-state-line="pin"]').innerHTML = `<strong>PIN:</strong> ${pin.value.length ? `new value entered - will be ${activeMember.hasPin ? "replaced" : "set for the first time"}` : activeMember.hasPin ? "currently set - will not change" : "not set - will remain not set"}`;
  }

  function handleSubmit(event) {
    event.preventDefault();
    const password = document.getElementById("new-password").value;
    const pin = document.getElementById("new-pin").value;
    if (!password && !pin) return showState("dialog-nothing-error");
    if (pin && !/^[0-9]{4}$/.test(pin)) return showState("dialog-pin-error");
    showState("dialog-saving");
  }

  function trapDialogFocus(event) {
    const dialog = modalRoot.querySelector('[role="dialog"]');
    if (!dialog) return;
    const saving = currentState === "dialog-saving";
    if (event.key === "Escape" && !saving) {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]'));
    if (!focusable.length) {
      event.preventDefault();
      dialog.setAttribute("tabindex", "-1");
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closeDialog(skipFocus) {
    document.removeEventListener("keydown", trapDialogFocus);
    modalRoot.innerHTML = "";
    appShell.removeAttribute("aria-hidden");
    currentState = "roster";
    document.querySelectorAll(".state-button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.state === "roster")));
    if (!skipFocus && lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  }
})();
