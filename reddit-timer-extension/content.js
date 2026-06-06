// content.js

(function () {
  // Prevent running in iframes
  if (window.self !== window.top) return;

  let rootContainer = null;
  let shadowRoot = null;
  let timerDisplay = null;
  let cardElement = null;

  let isPaused = false;
  let secondsToday = 0;
  let tickInterval = null;

  // Drag state variables
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let elementStartX = 0;
  let elementStartY = 0;

  // Initialize tracking
  async function init() {
    createUI();
    await loadSettings();
    syncTime();
    startTimer();
    setupListeners();
  }

  // Create UI elements inside Shadow DOM
  function createUI() {
    rootContainer = document.createElement('div');
    rootContainer.id = 'reddit-time-tracker-root';
    
    // Position fixed container
    rootContainer.style.position = 'fixed';
    rootContainer.style.top = '16px';
    rootContainer.style.left = '16px';
    rootContainer.style.zIndex = '999999';
    rootContainer.style.display = 'block';

    // Create shadow root to isolate styles
    shadowRoot = rootContainer.attachShadow({ mode: 'open' });

    // Inject styles inline to bypass Manifest V3 web_accessible_resources issues
    const style = document.createElement('style');
    style.textContent = `
      :host {
        --bg-color: #ffffff;
        --border-color: #000000;
        --text-color: #000000;
        --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .tracker-card {
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-color) !important;
        border: 2px solid var(--border-color) !important;
        border-radius: 4px !important;
        padding: 6px 10px !important;
        color: var(--text-color) !important;
        box-shadow: 3px 3px 0px rgba(0, 0, 0, 0.15) !important;
        cursor: move !important;
        white-space: nowrap !important;
        box-sizing: border-box !important;
        transition: transform 0.1s ease, box-shadow 0.1s ease;
        user-select: none !important;
      }
      .tracker-card:hover {
        transform: translate(-1px, -1px);
        box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.2) !important;
      }
      .tracker-card:active {
        cursor: grabbing !important;
        transform: translate(0px, 0px);
        box-shadow: 2px 2px 0px rgba(0, 0, 0, 0.15) !important;
      }
      .timer-display {
        font-family: var(--font-mono) !important;
        font-size: 14px !important;
        font-weight: bold !important;
        color: var(--text-color) !important;
        letter-spacing: 0.5px !important;
        line-height: 1 !important;
      }
      .tracker-card.paused {
        opacity: 0.6 !important;
        border-style: dashed !important;
      }
    `;
    shadowRoot.appendChild(style);

    // Create the timer card HTML
    cardElement = document.createElement('div');
    cardElement.id = 'tracker-card';
    cardElement.className = 'tracker-card';
    cardElement.title = 'Double-click to pause/resume. Drag to reposition.';
    cardElement.innerHTML = `
      <div id="timer-display" class="timer-display">00:00:00</div>
    `;

    shadowRoot.appendChild(cardElement);
    document.body.appendChild(rootContainer);

    timerDisplay = shadowRoot.getElementById('timer-display');
  }

  // Load position and paused preferences
  async function loadSettings() {
    try {
      const data = await chrome.storage.local.get(['position', 'isPaused']);
      
      // Position restore
      if (data.position) {
        rootContainer.style.top = data.position.top;
        rootContainer.style.left = data.position.left;
      }
      
      // Paused restore
      if (data.isPaused) {
        isPaused = true;
        updatePauseUI(true);
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  }

  // Start tracking interval
  function startTimer() {
    if (tickInterval) clearInterval(tickInterval);
    
    tickInterval = setInterval(() => {
      // Only send ticks if document is focused and visible
      const isFocused = document.hasFocus() && document.visibilityState === 'visible';
      
      if (isFocused && !isPaused) {
        chrome.runtime.sendMessage({ type: 'TICK' }, (response) => {
          if (chrome.runtime.lastError) {
            console.debug('Extension connection inactive');
            return;
          }
          if (response) {
            updateUI(response.secondsToday, response.isPaused);
            if (response.playSound) {
              playWarningSound();
            }
          }
        });
      }
    }, 1000);
  }

  // Query background for current status
  function syncTime() {
    chrome.runtime.sendMessage({ type: 'GET_TIME' }, (response) => {
      if (chrome.runtime.lastError) {
        console.debug('Extension connection inactive');
        return;
      }
      if (response) {
        updateUI(response.secondsToday, response.isPaused);
      }
    });
  }

  // Update UI display
  function updateUI(seconds, paused) {
    secondsToday = seconds;
    timerDisplay.textContent = formatTime(secondsToday);
    
    if (paused !== undefined && paused !== isPaused) {
      isPaused = paused;
      updatePauseUI(isPaused);
    }
  }

  function updatePauseUI(paused) {
    if (paused) {
      cardElement.classList.add('paused');
      cardElement.title = 'Paused. Double-click to resume tracking. Drag to reposition.';
    } else {
      cardElement.classList.remove('paused');
      cardElement.title = 'Double-click to pause tracking. Drag to reposition.';
    }
  }

  // Formats seconds into HH:MM:SS
  function formatTime(totalSeconds) {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return [
      hrs.toString().padStart(2, '0'),
      mins.toString().padStart(2, '0'),
      secs.toString().padStart(2, '0')
    ].join(':');
  }

  // Plays synthesized warning sound via Web Audio API
  function playWarningSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      // Play a dual-tone beep (be-beep!)
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc1.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.15); // A5
      
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(293.66, audioCtx.currentTime); // D4
      osc2.frequency.setValueAtTime(440.00, audioCtx.currentTime + 0.15); // A4
      
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime + 0.12);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);
      gainNode.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.17);
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime + 0.27);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc1.start();
      osc2.start();
      
      osc1.stop(audioCtx.currentTime + 0.35);
      osc2.stop(audioCtx.currentTime + 0.35);
    } catch (error) {
      console.warn('Failed to play warning sound via Web Audio API:', error);
    }
  }

  // Setup event listeners
  function setupListeners() {
    // 1. Visibility and Focus Change Listener
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        syncTime();
      }
    });
    window.addEventListener('focus', syncTime);

    // 2. Drag & Drop functionality on the entire card
    cardElement.addEventListener('mousedown', onMouseDown);

    // 3. Pause/Resume on Double Click
    cardElement.addEventListener('dblclick', togglePause);
  }

  // Toggle Pause
  function togglePause(e) {
    e.stopPropagation();
    isPaused = !isPaused;
    updatePauseUI(isPaused);
    
    chrome.runtime.sendMessage({ type: 'SET_PAUSED', paused: isPaused }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to send pause update:', chrome.runtime.lastError);
      }
    });
  }

  // Drag event handler: Mouse Down
  function onMouseDown(e) {
    // Only drag with left click
    if (e.button !== 0) return;
    
    // Prevent text selection while dragging
    e.preventDefault();

    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    const computedStyle = window.getComputedStyle(rootContainer);
    elementStartX = parseInt(computedStyle.left, 10) || 16;
    elementStartY = parseInt(computedStyle.top, 10) || 16;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // Drag event handler: Mouse Move
  function onMouseMove(e) {
    if (!isDragging) return;

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    let newLeft = elementStartX + dx;
    let newTop = elementStartY + dy;

    // Bounds checking (keep within viewport)
    const cardWidth = rootContainer.offsetWidth || 100;
    const cardHeight = rootContainer.offsetHeight || 32;
    const padding = 8;

    const maxLeft = window.innerWidth - cardWidth - padding;
    const maxTop = window.innerHeight - cardHeight - padding;

    newLeft = Math.max(padding, Math.min(newLeft, maxLeft));
    newTop = Math.max(padding, Math.min(newTop, maxTop));

    rootContainer.style.left = `${newLeft}px`;
    rootContainer.style.top = `${newTop}px`;
  }

  // Drag event handler: Mouse Up
  async function onMouseUp() {
    if (!isDragging) return;
    
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    // Save position
    const position = {
      top: rootContainer.style.top,
      left: rootContainer.style.left
    };

    try {
      await chrome.storage.local.set({ position });
    } catch (e) {
      console.warn('Failed to save position:', e);
    }
  }

  // Run initializer
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
