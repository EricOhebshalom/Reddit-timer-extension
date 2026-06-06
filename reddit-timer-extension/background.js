// background.js

let lastTickTime = 0; // In-memory rate limiting to prevent double counting across tabs

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TICK') {
    handleTick(sender, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.type === 'GET_TIME') {
    handleGetTime(sendResponse);
    return true;
  } else if (message.type === 'SET_PAUSED') {
    handleSetPaused(message.paused, sendResponse);
    return true;
  }
});

/**
 * Handles a time tick from an active old.reddit.com tab.
 */
async function handleTick(sender, sendResponse) {
  try {
    const now = Date.now();
    // Rate limit ticks to once per 950ms to prevent double counting if multiple tabs are active
    if (now - lastTickTime < 950) {
      const data = await chrome.storage.local.get(['secondsToday', 'isPaused']);
      sendResponse({
        secondsToday: data.secondsToday || 0,
        isPaused: !!data.isPaused
      });
      return;
    }

    const data = await chrome.storage.local.get(['secondsToday', 'lastTrackedDate', 'isPaused', 'lastWarningPlayedMinute']);
    const isPaused = !!data.isPaused;

    if (isPaused) {
      sendResponse({
        secondsToday: data.secondsToday || 0,
        isPaused: true
      });
      return;
    }

    // Check if the date has changed (midnight reset)
    const todayStr = new Date().toLocaleDateString('en-US'); // Local timezone
    let secondsToday = data.secondsToday || 0;
    let lastTrackedDate = data.lastTrackedDate;
    let lastWarningPlayedMinute = data.lastWarningPlayedMinute || 0;

    if (lastTrackedDate !== todayStr) {
      secondsToday = 0;
      lastTrackedDate = todayStr;
      lastWarningPlayedMinute = 0;
    }

    // Check if the user is active (not idle in the last 15 seconds)
    const idleState = await chrome.idle.queryState(15);
    const isUserActive = idleState === 'active';
    let playSound = false;

    if (isUserActive) {
      secondsToday++;
      lastTickTime = now;

      // Check if a new 10-minute threshold (600 seconds) is reached
      const currentTenMinInterval = Math.floor(secondsToday / 600);
      if (currentTenMinInterval > lastWarningPlayedMinute && secondsToday >= 600) {
        playSound = true;
        lastWarningPlayedMinute = currentTenMinInterval;
      }
    }

    await chrome.storage.local.set({ secondsToday, lastTrackedDate, lastWarningPlayedMinute });

    sendResponse({
      secondsToday,
      isPaused: false,
      playSound: playSound
    });
  } catch (error) {
    console.error('Error handling tick in background:', error);
    sendResponse({ error: error.message });
  }
}

/**
 * Retrieves the current accumulated time and pause state.
 */
async function handleGetTime(sendResponse) {
  try {
    const data = await chrome.storage.local.get(['secondsToday', 'lastTrackedDate', 'isPaused', 'lastWarningPlayedMinute']);
    const todayStr = new Date().toLocaleDateString('en-US');
    let secondsToday = data.secondsToday || 0;
    let lastTrackedDate = data.lastTrackedDate;
    let lastWarningPlayedMinute = data.lastWarningPlayedMinute || 0;

    if (lastTrackedDate !== todayStr) {
      secondsToday = 0;
      lastTrackedDate = todayStr;
      lastWarningPlayedMinute = 0;
      await chrome.storage.local.set({ secondsToday, lastTrackedDate, lastWarningPlayedMinute });
    }

    sendResponse({
      secondsToday,
      isPaused: !!data.isPaused
    });
  } catch (error) {
    console.error('Error getting time in background:', error);
    sendResponse({ error: error.message });
  }
}

/**
 * Pauses or resumes the timer.
 */
async function handleSetPaused(paused, sendResponse) {
  try {
    await chrome.storage.local.set({ isPaused: paused });
    sendResponse({ success: true, isPaused: paused });
  } catch (error) {
    console.error('Error setting paused in background:', error);
    sendResponse({ error: error.message });
  }
}
