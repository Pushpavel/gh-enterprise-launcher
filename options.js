// Options page script for Devcontainer Launcher

const form = document.getElementById('options-form');
const gheUrlInput = document.getElementById('gheUrl');
const launcherUrlInput = document.getElementById('launcherUrl');
const statusEl = document.getElementById('status');

// Load saved settings on page load
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const result = await chrome.storage.sync.get(['gheUrl', 'launcherUrl']);
    
    if (result.gheUrl) {
      gheUrlInput.value = result.gheUrl;
    }
    if (result.launcherUrl) {
      launcherUrlInput.value = result.launcherUrl;
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
});

// Save settings on form submit
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  let gheUrl = gheUrlInput.value.trim();
  const launcherUrl = launcherUrlInput.value.trim();
  
  // Remove trailing slash from GHE URL
  if (gheUrl.endsWith('/')) {
    gheUrl = gheUrl.slice(0, -1);
  }
  
  try {
    await chrome.storage.sync.set({
      gheUrl: gheUrl,
      launcherUrl: launcherUrl
    });
    
    // Update the input with normalized URL
    gheUrlInput.value = gheUrl;
    
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
