(() => {
  'use strict';

  const form = document.querySelector('#signInForm');
  const username = document.querySelector('#username');
  const password = document.querySelector('#password');
  const passwordToggle = document.querySelector('#passwordToggle');
  const submitButton = document.querySelector('#submitButton');
  const formAlert = document.querySelector('#formAlert');
  const usernameError = document.querySelector('#usernameError');
  const passwordError = document.querySelector('#passwordError');
  const liveRegion = document.querySelector('#liveRegion');
  const contextToggle = document.querySelector('#contextToggle');
  const destinationContext = document.querySelector('#destinationContext');
  const stateButtons = [...document.querySelectorAll('[data-state]')];

  let isSubmitting = false;
  let submitTimer;

  const announce = (message) => {
    liveRegion.textContent = '';
    window.setTimeout(() => { liveRegion.textContent = message; }, 20);
  };

  const setFieldError = (input, error, message, shouldShow) => {
    input.setAttribute('aria-invalid', String(shouldShow));
    error.hidden = !shouldShow;
    if (shouldShow) error.textContent = message;
  };

  const clearErrors = () => {
    setFieldError(username, usernameError, 'Username is required', false);
    setFieldError(password, passwordError, 'Password is required', false);
    formAlert.hidden = true;
  };

  const setLoading = (loading) => {
    isSubmitting = loading;
    submitButton.disabled = loading;
    submitButton.classList.toggle('is-loading', loading);
    submitButton.setAttribute('aria-busy', String(loading));
    username.disabled = loading;
    password.disabled = loading;
    passwordToggle.disabled = loading;
  };

  const setActiveStateButton = (state) => {
    stateButtons.forEach((button) => {
      const active = button.dataset.state === state;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const showRequiredErrors = (moveFocus = false) => {
    clearErrors();
    const usernameMissing = username.value === '';
    const passwordMissing = password.value === '';
    setFieldError(username, usernameError, 'Username is required', usernameMissing);
    setFieldError(password, passwordError, 'Password is required', passwordMissing);

    const messages = [];
    if (usernameMissing) messages.push('Username is required');
    if (passwordMissing) messages.push('Password is required');
    if (messages.length) {
      announce(messages.join('. '));
      if (moveFocus) (usernameMissing ? username : password).focus();
    }
    return messages.length > 0;
  };

  const applyPreviewState = (state) => {
    window.clearTimeout(submitTimer);
    setLoading(false);
    clearErrors();

    if (state === 'required') {
      username.value = '';
      password.value = '';
      showRequiredErrors(false);
    } else if (state === 'invalid') {
      username.value = 'studio.admin';
      password.value = 'not-the-password';
      formAlert.hidden = false;
      announce('Invalid username or password.');
    } else if (state === 'loading') {
      username.value = username.value || 'studio.admin';
      password.value = password.value || 'password';
      setLoading(true);
      announce('Signing in.');
    } else {
      username.value = '';
      password.value = '';
      announce('Default sign-in state.');
    }

    setActiveStateButton(state);
  };

  passwordToggle.addEventListener('click', () => {
    const willShow = password.type === 'password';
    password.type = willShow ? 'text' : 'password';
    passwordToggle.setAttribute('aria-pressed', String(willShow));
    passwordToggle.setAttribute('aria-label', willShow ? 'Hide password' : 'Show password');
  });

  username.addEventListener('input', () => {
    if (username.value !== '') setFieldError(username, usernameError, 'Username is required', false);
    formAlert.hidden = true;
  });

  password.addEventListener('input', () => {
    if (password.value !== '') setFieldError(password, passwordError, 'Password is required', false);
    formAlert.hidden = true;
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    clearErrors();

    if (showRequiredErrors(true)) {
      setActiveStateButton('required');
      return;
    }

    setLoading(true);
    setActiveStateButton('loading');
    announce('Signing in.');

    submitTimer = window.setTimeout(() => {
      setLoading(false);
      formAlert.hidden = false;
      formAlert.focus();
      setActiveStateButton('invalid');
      announce('Invalid username or password.');
    }, 1100);
  });

  stateButtons.forEach((button) => {
    button.addEventListener('click', () => applyPreviewState(button.dataset.state));
  });

  contextToggle.addEventListener('change', () => {
    destinationContext.hidden = !contextToggle.checked;
    announce(contextToggle.checked
      ? 'Protected link context shown. Sign in to continue to Inventory counts.'
      : 'Protected link context hidden. Direct sign-in returns to the administrator dashboard.');
  });
})();

