document.addEventListener('DOMContentLoaded', () => {
    const btnSelect = document.getElementById('btn-select');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const infoText = document.getElementById('selection-info');
    const statusText = document.getElementById('status-text');
    const indicator = document.getElementById('status-indicator');
    
    const inputDelay = document.getElementById('input-delay');
    const toggleRepeat = document.getElementById('toggle-repeat');
    const toggleRefresh = document.getElementById('toggle-refresh');
    const inputRefreshDelay = document.getElementById('input-refresh-delay');
    const inputWebhook = document.getElementById('input-webhook');

    // Load saved settings on load
    chrome.storage.local.get(['delay', 'repeat', 'refreshEnabled', 'refreshDelay', 'x', 'y', 'discordWebhook'], (data) => {
        if (data.delay) inputDelay.value = data.delay;
        if (data.repeat !== undefined) toggleRepeat.checked = data.repeat;
        if (data.refreshEnabled !== undefined) toggleRefresh.checked = data.refreshEnabled;
        if (data.refreshDelay) inputRefreshDelay.value = data.refreshDelay;
        if (data.discordWebhook) inputWebhook.value = data.discordWebhook;
    });

    // Save settings when changed
    inputDelay.addEventListener('change', () => chrome.storage.local.set({ delay: inputDelay.value }));
    toggleRepeat.addEventListener('change', () => chrome.storage.local.set({ repeat: toggleRepeat.checked }));
    toggleRefresh.addEventListener('change', () => chrome.storage.local.set({ refreshEnabled: toggleRefresh.checked }));
    inputRefreshDelay.addEventListener('change', () => chrome.storage.local.set({ refreshDelay: inputRefreshDelay.value }));
    inputWebhook.addEventListener('change', () => chrome.storage.local.set({ discordWebhook: inputWebhook.value }));

    // Function to ensure content.js is injected
    function ensureScriptInjected(tabId, callback) {
        chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
            if (chrome.runtime.lastError) {
                // Not injected yet
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ["content.js"]
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('Script injection failed:', chrome.runtime.lastError.message);
                        callback(false);
                    } else {
                        callback(true);
                    }
                });
            } else {
                callback(true);
            }
        });
    }

    function updateStatusUI(isRunning, hasSelection, x, y) {
        if (isRunning) {
            statusText.textContent = "Status: Running...";
            indicator.className = "indicator running";
            btnStart.disabled = true;
            btnStop.disabled = false;
            btnSelect.disabled = true;
            inputDelay.disabled = true;
            toggleRepeat.disabled = true;
            toggleRefresh.disabled = true;
            inputRefreshDelay.disabled = true;
            inputWebhook.disabled = true;
        } else {
            statusText.textContent = "Status: Idle";
            indicator.className = "indicator idle";
            btnStart.disabled = !hasSelection;
            btnStop.disabled = true;
            btnSelect.disabled = false;
            inputDelay.disabled = false;
            toggleRepeat.disabled = false;
            toggleRefresh.disabled = false;
            inputRefreshDelay.disabled = false;
            inputWebhook.disabled = false;
        }
        
        if (hasSelection) {
            infoText.textContent = `Target set at: (X: ${x}, Y: ${y})`;
        } else {
            infoText.textContent = "No target selected";
        }
    }

    function syncState() {
        chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
            if (res) updateStatusUI(res.isRunning, res.hasSelection, res.x, res.y);
        });
    }

    syncState();

    btnSelect.addEventListener('click', async () => {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Firefox specific checks for restricted pages
        if (!tab || tab.url.startsWith("about:") || tab.url.startsWith("moz-extension://")) {
            alert("Cannot select areas on restricted Firefox pages.");
            return;
        }

        ensureScriptInjected(tab.id, (success) => {
            if (!success) {
                alert("Failed to inject script to page. Refresh the page and try again.");
                return;
            }
            
            // Start selection process visually in popup
            statusText.textContent = "Status: Selecting...";
            indicator.className = "indicator selecting";
            btnSelect.disabled = true;
            btnStart.disabled = true;

            chrome.tabs.sendMessage(tab.id, { action: "START_SELECTION" }, () => {
                if(chrome.runtime.lastError) {
                    console.error("Msg error:", chrome.runtime.lastError);
                } else {
                    // Close the popup to let user interact with the active page
                    window.close();
                }
            });
        });
    });

    btnStart.addEventListener('click', () => {
        const delay = parseFloat(inputDelay.value);
        if (isNaN(delay) || delay < 0.1) {
            alert("Please enter a valid delay (minimum 0.1s).");
            return;
        }
        
        const refreshDelay = parseFloat(inputRefreshDelay.value);
        if (toggleRefresh.checked && (isNaN(refreshDelay) || refreshDelay < 0.1)) {
            alert("Please enter a valid refresh delay (minimum 0.1s).");
            return;
        }
        
        // Save state one more time before running
        chrome.storage.local.set({ 
            delay: delay, 
            repeat: toggleRepeat.checked,
            refreshEnabled: toggleRefresh.checked,
            refreshDelay: refreshDelay
        });

        chrome.runtime.sendMessage({ 
            action: 'START_TIMER',
            delaySec: delay,
            repeat: toggleRepeat.checked,
            refreshEnabled: toggleRefresh.checked,
            refreshDelay: refreshDelay
        }, (res) => {
            if (res && res.status === "started") {
                syncState();
            } else if (res && res.status === "error") {
                alert(res.message);
            }
        });
    });

    btnStop.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'STOP_TIMER' }, () => {
            syncState();
        });
    });

    // Automatically sync state when it regains focus or something changes
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'SELECTION_MADE') {
            syncState();
        }
    });

    // Polling is completely acceptable for keeping UI updated if external stops occur
    setInterval(syncState, 1000); 
});
