// Options page script for Devcontainer Launcher

const form = document.getElementById('options-form');
const gheUrlInput = document.getElementById('gheUrl');
const coderUrlInput = document.getElementById('coderUrl');
const coderApiTokenInput = document.getElementById('coderApiToken');
const launcherUrlInput = document.getElementById('launcherUrl');
const verifyBtn = document.getElementById('verifyBtn');
const getTokenLink = document.getElementById('getTokenLink');
const statusEl = document.getElementById('status');
const connectionStatus = document.getElementById('connectionStatus');
const connectionStatusText = document.getElementById('connectionStatusText');

// Load saved settings on page load
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const result = await chrome.storage.sync.get([
      'gheUrl', 'launcherUrl', 'coderUrl', 'coderApiToken'
    ]);
    
    if (result.gheUrl) {
      gheUrlInput.value = result.gheUrl;
    }
    if (result.launcherUrl) {
      launcherUrlInput.value = result.launcherUrl;
    }
    if (result.coderUrl) {
      coderUrlInput.value = result.coderUrl;
      updateGetTokenLink(result.coderUrl);
    }
    if (result.coderApiToken) {
      // Show placeholder for existing token
      coderApiTokenInput.placeholder = '••••••••••••••••';
      coderApiTokenInput.dataset.hasExisting = 'true';
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
});

// Update "Get Token" link when Coder URL changes
coderUrlInput.addEventListener('input', () => {
  updateGetTokenLink(coderUrlInput.value);
});

function updateGetTokenLink(coderUrl) {
  if (coderUrl) {
    try {
      const url = new URL(coderUrl);
      getTokenLink.href = `${url.origin}/settings/tokens`;
      getTokenLink.style.display = 'inline-flex';
    } catch (e) {
      getTokenLink.style.display = 'none';
    }
  } else {
    getTokenLink.style.display = 'none';
  }
}

// Verify connection
verifyBtn.addEventListener('click', async () => {
  const coderUrl = normalizeUrl(coderUrlInput.value);
  const apiToken = coderApiTokenInput.value || null;
  
  if (!coderUrl) {
    showConnectionStatus('Please enter Coder URL first', 'warning');
    return;
  }
  
  // Use existing token if no new one entered
  let tokenToUse = apiToken;
  if (!tokenToUse && coderApiTokenInput.dataset.hasExisting) {
    const stored = await chrome.storage.sync.get(['coderApiToken']);
    tokenToUse = stored.coderApiToken;
  }
  
  if (!tokenToUse) {
    showConnectionStatus('Please enter API token first', 'warning');
    return;
  }
  
  // Show loading state
  verifyBtn.disabled = true;
  verifyBtn.innerHTML = '<span class="spinner"></span> Verifying...';
  
  try {
    const result = await chrome.runtime.sendMessage({
      action: 'VERIFY_CONNECTION',
      coderUrl: coderUrl,
      apiToken: tokenToUse
    });
    
    if (result.success) {
      showConnectionStatus(
        `Connected as ${result.username}${result.email ? ` (${result.email})` : ''}`,
        'success'
      );
    } else {
      showConnectionStatus(result.error || 'Connection failed', 'error');
    }
  } catch (error) {
    showConnectionStatus(`Error: ${error.message}`, 'error');
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.innerHTML = 'Verify';
  }
});

function showConnectionStatus(message, type) {
  connectionStatusText.textContent = message;
  connectionStatus.className = `connection-status show ${type}`;
  
  // Update icon based on type
  const iconSvg = connectionStatus.querySelector('svg');
  if (type === 'success') {
    iconSvg.innerHTML = '<path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z"/>';
  } else if (type === 'error') {
    iconSvg.innerHTML = '<path d="M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z"/>';
  } else {
    iconSvg.innerHTML = '<path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>';
  }
}

function normalizeUrl(url) {
  let normalized = url.trim();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

// Save settings on form submit
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const gheUrl = normalizeUrl(gheUrlInput.value);
  const coderUrl = normalizeUrl(coderUrlInput.value);
  const launcherUrl = launcherUrlInput.value.trim();
  
  // Only save new token if user entered one
  const newToken = coderApiTokenInput.value;
  
  try {
    const dataToSave = {
      gheUrl: gheUrl,
      coderUrl: coderUrl,
      launcherUrl: launcherUrl
    };
    
    // Only update token if a new one was entered
    if (newToken) {
      dataToSave.coderApiToken = newToken;
    }
    
    await chrome.storage.sync.set(dataToSave);
    
    // Update inputs with normalized URLs
    gheUrlInput.value = gheUrl;
    coderUrlInput.value = coderUrl;
    
    // Mark token as saved
    if (newToken) {
      coderApiTokenInput.value = '';
      coderApiTokenInput.placeholder = '••••••••••••••••';
      coderApiTokenInput.dataset.hasExisting = 'true';
    }
    
    showStatus('Settings saved!', 'success');
  } catch (error) {
    console.error('Failed to save settings:', error);
    showStatus('Failed to save settings', 'error');
  }
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status show ${type}`;
  
  setTimeout(() => {
    statusEl.className = 'status';
  }, 3000);
}
