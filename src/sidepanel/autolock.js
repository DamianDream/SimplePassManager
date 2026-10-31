/**
 * Inactivity Autolock Monitor
 * Tracks user activity and triggers lock callback after configured minutes of inactivity.
 */

let timer = null;
let currentMinutes = 15;
let currentOnLock = null;
let isStarted = false;

function onUserActivity() {
  if (!isStarted || currentMinutes <= 0) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (typeof currentOnLock === 'function') {
      currentOnLock();
    }
  }, currentMinutes * 60 * 1000);
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'];

export function startAutolock({ idleMinutes = 15, onLock }) {
  stopAutolock();
  currentMinutes = Number(idleMinutes) || 0;
  currentOnLock = onLock;
  isStarted = true;

  if (typeof document !== 'undefined') {
    ACTIVITY_EVENTS.forEach(ev => {
      document.addEventListener(ev, onUserActivity, { passive: true });
    });
  }

  // Initial arm
  onUserActivity();

  return {
    stop: stopAutolock,
    reset: onUserActivity,
    updateInterval: (newMinutes) => {
      currentMinutes = Number(newMinutes) || 0;
      onUserActivity();
    }
  };
}

export function stopAutolock() {
  isStarted = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (typeof document !== 'undefined') {
    ACTIVITY_EVENTS.forEach(ev => {
      document.removeEventListener(ev, onUserActivity);
    });
  }
}

export function resetAutolock() {
  onUserActivity();
}
