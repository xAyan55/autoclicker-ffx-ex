let overlay = null;
let isSelecting = false;
let countdownOverlay = null;
let countdownTimer = null;

function createOverlay() {
    if(overlay) return;
    overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none'; // Critical: allows clicking elements beneath
    overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.3)'; // accent blue
    overlay.style.border = '2px solid rgb(59, 130, 246)';
    overlay.style.zIndex = '2147483647'; // Max z-index
    overlay.style.transition = 'all 0.05s ease';
    document.body.appendChild(overlay);
}

function removeOverlay() {
    if(overlay) {
        overlay.remove();
        overlay = null;
    }
}

function handleMouseMove(e) {
    if(!isSelecting) return;
    
    // Temporarily disable overlay pointer events just in case
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if(el && el !== overlay) {
        const rect = el.getBoundingClientRect();
        createOverlay();
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
    }
}

function handleClick(e) {
    if(!isSelecting) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation(); // Block page logic
    
    isSelecting = false;
    const x = e.clientX;
    const y = e.clientY;
    
    // Success feedback
    if(overlay) {
        overlay.style.backgroundColor = 'rgba(16, 185, 129, 0.5)'; // green
        overlay.style.border = '2px solid rgb(16, 185, 129)';
    }
    
    // Add 500ms delay for selection visual confirmation
    setTimeout(() => {
        removeOverlay();
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('click', handleClick, true);
        
        chrome.runtime.sendMessage({
            action: 'SELECTION_MADE',
            x: x,
            y: y
        });
    }, 500); 
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "ping") {
        sendResponse({ status: "ok" });
    } else if (msg.action === "START_SELECTION") {
        isSelecting = true;
        // Ensure no previous stuck listeners
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('click', handleClick, true);
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('click', handleClick, true); // Capture phase to prevent default
        sendResponse({ status: "started" });
    } else if (msg.action === "CLICK_AT") {
        createClickHighlight(msg.x, msg.y); 
        const el = document.elementFromPoint(msg.x, msg.y);
        // Simulate click
        if (el) {
            el.click();
        }
        sendResponse({ status: "clicked" });
    } else if (msg.action === "UPDATE_COUNTDOWN") {
        showCountdownOverlay(msg.targetTime, msg.x, msg.y);
        sendResponse({ status: "ok" });
    } else if (msg.action === "HIDE_COUNTDOWN") {
        hideCountdownOverlay();
        sendResponse({ status: "ok" });
    }
    return true; 
});

// Provides visual feedback whenever a click is automatically simulated
function createClickHighlight(x, y) {
    const clickVisual = document.createElement('div');
    clickVisual.style.position = 'fixed';
    clickVisual.style.left = (x - 15) + 'px';
    clickVisual.style.top = (y - 15) + 'px';
    clickVisual.style.width = '30px';
    clickVisual.style.height = '30px';
    clickVisual.style.borderRadius = '50%';
    clickVisual.style.backgroundColor = 'rgba(239, 68, 68, 0.6)'; // accent red
    clickVisual.style.zIndex = '2147483647';
    clickVisual.style.pointerEvents = 'none';
    clickVisual.style.animation = 'clickRipple 0.5s linear forwards';
    document.body.appendChild(clickVisual);

    if(!document.getElementById('ac-styles')) {
        const style = document.createElement('style');
        style.id = 'ac-styles';
        style.innerHTML = `
            @keyframes clickRipple {
                0% { transform: scale(0.3); opacity: 1; }
                100% { transform: scale(2.5); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Cleanup
    setTimeout(() => clickVisual.remove(), 500);
}

function showCountdownOverlay(targetTime, x, y) {
    if (!countdownOverlay) {
        countdownOverlay = document.createElement('div');
        countdownOverlay.style.position = 'fixed';
        countdownOverlay.style.backgroundColor = 'rgba(15, 23, 42, 0.85)';
        countdownOverlay.style.color = '#38bdf8';
        countdownOverlay.style.padding = '4px 8px';
        countdownOverlay.style.borderRadius = '6px';
        countdownOverlay.style.fontSize = '12px';
        countdownOverlay.style.fontWeight = 'bold';
        countdownOverlay.style.fontFamily = 'monospace';
        countdownOverlay.style.zIndex = '2147483647';
        countdownOverlay.style.pointerEvents = 'none';
        countdownOverlay.style.transform = 'translate(-50%, -120%)';
        countdownOverlay.style.border = '1px solid #38bdf8';
        countdownOverlay.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
        document.body.appendChild(countdownOverlay);
    }
    countdownOverlay.style.left = x + 'px';
    countdownOverlay.style.top = y + 'px';
    countdownOverlay.style.display = 'block';

    function update() {
        if (!countdownOverlay) return;
        const now = Date.now();
        const remaining = Math.max(0, targetTime - now);
        countdownOverlay.textContent = `Next click: ${(remaining / 1000).toFixed(1)}s`;
        if (remaining > 0) {
            countdownTimer = requestAnimationFrame(update);
        } else {
            countdownOverlay.textContent = "Clicking...";
        }
    }
    
    if (countdownTimer) cancelAnimationFrame(countdownTimer);
    update();
}

function hideCountdownOverlay() {
    if (countdownOverlay) {
        countdownOverlay.remove();
        countdownOverlay = null;
    }
    if (countdownTimer) {
        cancelAnimationFrame(countdownTimer);
        countdownTimer = null;
    }
}

// On load, ask background if it's running so we can show the countdown if a refresh happened
chrome.runtime.sendMessage({ action: "GET_STATUS" }, (res) => {
    if (res && res.isRunning && res.nextClickTime && res.x !== undefined && res.y !== undefined) {
        showCountdownOverlay(res.nextClickTime, res.x, res.y);
    }
});
