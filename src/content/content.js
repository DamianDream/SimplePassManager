/**
 * Content Script for SimplePass Manager
 * Safely fills login credentials into active page forms and dispatches synthetic input events.
 */

function triggerInputEvents(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
}

function autofillCredentials(username, password) {
  const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(
    el => !el.disabled && el.offsetParent !== null
  );

  let success = false;

  if (passwordInputs.length > 0) {
    const pwdInput = passwordInputs[0];
    triggerInputEvents(pwdInput, password);
    success = true;

    // Search for the closest username / email field before this password input
    const form = pwdInput.closest('form') || document.body;
    const candidates = Array.from(
      form.querySelectorAll('input[type="text"], input[type="email"], input[autocomplete*="username"], input:not([type])')
    ).filter(el => !el.disabled && el.offsetParent !== null && el !== pwdInput);

    if (username && candidates.length > 0) {
      // Pick the candidate immediately preceding the password input or matching username/login/email
      let bestCandidate = candidates.find(
        c => /user|login|email|account|id/i.test(c.name || '') || /user|login|email|account|id/i.test(c.id || '')
      );
      if (!bestCandidate) {
        bestCandidate = candidates[0];
      }
      triggerInputEvents(bestCandidate, username);
    }
  }

  return success;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DO_AUTOFILL') {
    const filled = autofillCredentials(message.username, message.password);
    sendResponse({ success: filled });
  }
});
