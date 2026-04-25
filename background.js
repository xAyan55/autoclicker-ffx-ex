let clickInterval = null;
let isRunning = false;
let nextClickTime = 0;
let config = {
    x: null,
    y: null,
    delaySec: 5,
    repeat: false,
    refreshEnabled: false,
    refreshDelay: 2,
    tabId: null
};

function sendDiscordLog(title, description, color) {
    chrome.storage.local.get(['discordWebhook'], (data) => {
        if (!data.discordWebhook || !data.discordWebhook.startsWith("http")) return;

        const payload = {
            embeds: [{
                title: title,
                description: description,
                color: color,
                timestamp: new Date().toISOString()
            }]
        };

        fetch(data.discordWebhook, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        }).catch(err => console.error("Discord Webhook Error:", err));
    });
}

// Workaround to keep MV3 background script alive during short active intervals
const KEEP_ALIVE_INTERVAL = 20000; 
let keepAliveTimer = setInterval(() => {
    if (isRunning) {
        // Trivial API call to reset the idle worker timer
        chrome.runtime.getPlatformInfo(() => { }); 
    }
}, KEEP_ALIVE_INTERVAL);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'SELECTION_MADE') {
        config.x = msg.x;
        config.y = msg.y;
        if (sender.tab) {
            config.tabId = sender.tab.id;
        }
        chrome.storage.local.set({ x: msg.x, y: msg.y, tabId: config.tabId });
        sendDiscordLog("Target Selected", `A new click target was set at **X: ${msg.x}, Y: ${msg.y}**.`, 0x3498db);
        sendResponse({ status: "saved" });
    } 
    else if (msg.action === 'START_TIMER') {
        config.delaySec = msg.delaySec;
        config.repeat = msg.repeat;
        config.refreshEnabled = msg.refreshEnabled;
        config.refreshDelay = msg.refreshDelay;
        
        chrome.storage.local.get(['x', 'y', 'tabId'], (data) => {
            if (data.x !== undefined && data.y !== undefined && data.tabId) {
                config.x = data.x;
                config.y = data.y;
                config.tabId = data.tabId;
                startTimer();
                sendResponse({ status: "started" });
            } else {
                sendResponse({ status: "error", message: "No area selected." });
            }
        });
        return true; 
    } 
    else if (msg.action === 'STOP_TIMER') {
        stopTimer("Manually stopped from popup.");
        sendResponse({ status: "stopped" });
    }
    else if (msg.action === 'GET_STATUS') {
        chrome.storage.local.get(['x', 'y'], (data) => {
            sendResponse({ 
                isRunning: isRunning, 
                hasSelection: (data.x !== undefined && data.y !== undefined),
                x: data.x,
                y: data.y,
                nextClickTime: nextClickTime
            });
        });
        return true; 
    }
});

// Support for Hotkey start/stop toggle
chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-auto-clicker") {
        if (isRunning) {
            stopTimer("Stopped via keyboard shortcut.");
        } else {
            chrome.storage.local.get(['delay', 'repeat', 'refreshEnabled', 'refreshDelay', 'x', 'y', 'tabId'], (data) => {
                if (data.x !== undefined && data.y !== undefined && data.tabId) {
                    config.x = data.x;
                    config.y = data.y;
                    config.tabId = data.tabId;
                    config.delaySec = data.delay || 5;
                    config.repeat = data.repeat || false;
                    config.refreshEnabled = data.refreshEnabled || false;
                    config.refreshDelay = data.refreshDelay || 2;
                    startTimer();
                }
            });
        }
    }
});

function notifyContentScriptNextClick(targetTime) {
    if (config.tabId && config.x !== undefined && config.y !== undefined) {
        chrome.tabs.sendMessage(config.tabId, {
            action: 'UPDATE_COUNTDOWN',
            targetTime: targetTime,
            x: config.x,
            y: config.y
        }, () => {
            if (chrome.runtime.lastError) {}
        });
    }
}

function startTimer() {
    if (isRunning) stopTimer("Restarting timer with new configuration.");
    isRunning = true;
    
    // Ensure accurate millisecond conversion
    const delayMs = config.delaySec * 1000;
    
    sendDiscordLog("Auto Clicker Started", `**Target:** X: ${config.x}, Y: ${config.y}\n**Delay:** ${config.delaySec}s\n**Repeat:** ${config.repeat ? 'Yes' : 'No'}`, 0x2ecc71);
    
    nextClickTime = Date.now() + delayMs;
    notifyContentScriptNextClick(nextClickTime);
    
    if (config.repeat) {
        clickInterval = setInterval(() => {
            performClick();
            nextClickTime = Date.now() + delayMs;
            notifyContentScriptNextClick(nextClickTime);
        }, delayMs);
    } else {
        clickInterval = setTimeout(() => {
            performClick();
            stopTimer(); // Auto-stop if no repeat
        }, delayMs);
    }
}

function stopTimer(reason = "The auto clicker has been stopped.") {
    if (!isRunning) return;
    isRunning = false;
    nextClickTime = 0;
    if (clickInterval) {
        clearInterval(clickInterval);
        clearTimeout(clickInterval);
        clickInterval = null;
    }
    
    if (config.tabId) {
        chrome.tabs.sendMessage(config.tabId, { action: 'HIDE_COUNTDOWN' }, () => {
            if (chrome.runtime.lastError) {}
        });
    }
    
    sendDiscordLog("Auto Clicker Stopped", reason, 0xe74c3c);
}

function performClick() {
    if (config.tabId && config.x !== undefined && config.y !== undefined) {
        chrome.tabs.sendMessage(config.tabId, {
            action: 'CLICK_AT',
            x: config.x,
            y: config.y
        }, (response) => {
            // Check for execution failures (e.g., target tab closed or navigated)
            if (chrome.runtime.lastError) {
                console.warn("Target tab unavailable. Checking if tab exists.", chrome.runtime.lastError.message);
                chrome.tabs.get(config.tabId, (tab) => {
                    if (chrome.runtime.lastError) {
                        // Tab no longer exists, stop
                        stopTimer("Error: Target tab closed. Auto Clicker stopped.");
                    } else {
                        // Tab exists but might be reloading. Ignore and retry next interval.
                    }
                });
            } else {
                sendDiscordLog("Click Performed", `Successfully clicked at **X: ${config.x}, Y: ${config.y}**.`, 0x9b59b6);
                
                if (config.refreshEnabled) {
                    setTimeout(() => {
                        if (isRunning && config.tabId) {
                            chrome.tabs.reload(config.tabId, () => {
                                if (chrome.runtime.lastError) {}
                            });
                        }
                    }, config.refreshDelay * 1000);
                }
            }
        });
    }
}
