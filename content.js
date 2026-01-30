// Content script for GitHub Enterprise Devcontainer Launcher

(async function() {
  'use strict';

  // Load settings from storage
  const settings = await chrome.storage.sync.get(['gheUrl', 'launcherUrl']);
  
  // Exit if not configured
  if (!settings.gheUrl || !settings.launcherUrl) {
    return;
  }

  // Exit if current page doesn't match configured GHE URL
  const gheOrigin = new URL(settings.gheUrl).origin;
  if (location.origin !== gheOrigin) {
    return;
  }

  // Debounce to handle SPA navigation
  let injected = false;
  const BUTTON_ID = 'devcontainer-launcher-btn';

  /**
   * Extract repository info from the current page URL
   * Expected format: /owner/repo or /owner/repo/tree/branch/...
   */
  function getRepoInfo() {
    const pathParts = location.pathname.split('/').filter(Boolean);
    
    if (pathParts.length < 2) {
      return null;
    }

    const owner = pathParts[0];
    const repo = pathParts[1];
    
    // Skip non-repo pages
    const nonRepoPages = ['settings', 'organizations', 'users', 'search', 'notifications', 'login', 'logout'];
    if (nonRepoPages.includes(owner)) {
      return null;
    }

    return { owner, repo };
  }

  /**
   * Extract current branch/ref from the page
   * Tries multiple selectors for GHE 3.14 compatibility
   */
  function getCurrentBranch() {
    // Try various selectors used in different GHE versions
    const selectors = [
      // GHE 3.14+ branch selector button
      '[data-hotkey="w"] span.Text-sc-17v1xeu-0',
      '[data-hotkey="w"] span[data-component="text"]',
      // Branch menu button text
      '#branch-select-menu summary span.css-truncate-target',
      'summary[title] span.css-truncate-target',
      // Ref selector (newer UI)
      '[data-testid="anchor-button"] span',
      'button[aria-label*="branch"] span',
      // Code page branch display
      '.branch-select-menu summary span.css-truncate-target',
      // Fallback: any ref indicator
      '.ref-selector-button-text-container span',
      '[data-hotkey="w"]',
      // Octicon branch icon sibling
      '.octicon-git-branch + span',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text && text.length > 0 && !text.includes('/')) {
          return text;
        }
      }
    }

    // Try to extract from URL for /tree/branch paths
    const match = location.pathname.match(/\/tree\/([^/]+)/);
    if (match) {
      return match[1];
    }

    // Default to main/master
    return 'main';
  }

  /**
   * Construct SSH URL from repo info
   */
  function getSSHUrl(owner, repo) {
    const gheHost = new URL(settings.gheUrl).host;
    return `git@${gheHost}:${owner}/${repo}.git`;
  }

  /**
   * Build the launcher URL with placeholders replaced
   */
  function buildLauncherUrl(sshUrl, branch) {
    return settings.launcherUrl
      .replace(/\{ssh_url\}/g, encodeURIComponent(sshUrl))
      .replace(/\{branch\}/g, encodeURIComponent(branch));
  }

  /**
   * Create the launcher button element
   */
  function createLauncherButton(onClick) {
    const btn = document.createElement('a');
    btn.id = BUTTON_ID;
    btn.className = 'btn btn-primary devcontainer-launcher-btn';
    btn.href = '#';
    btn.setAttribute('role', 'button');
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 4px; vertical-align: text-bottom;">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
      </svg>
      Launch Devcontainer
    `;
    
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    
    return btn;
  }

  /**
   * Find the best insertion point for our button
   */
  function findInsertionPoint() {
    // Selectors for the Code button area in GHE 3.14
    const selectors = [
      // Primary: Get Code button container
      '[data-testid="code-button"]',
      'get-repo summary.btn',
      // Code dropdown button
      '.file-navigation details.get-repo-select-menu',
      '.file-navigation .BtnGroup',
      // Actions area near Code button
      '.file-navigation .d-flex.gap-2',
      '.file-navigation .flex-auto.min-width-0',
      // Repository header actions
      '.pagehead-actions',
      // Fallback: file navigation bar
      '.file-navigation',
      // Repository actions container
      '.repository-content .d-flex',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        return el;
      }
    }

    return null;
  }

  /**
   * Inject the launcher button into the page
   */
  function injectButton() {
    // Skip if already injected
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const repoInfo = getRepoInfo();
    if (!repoInfo) {
      return;
    }

    const insertionPoint = findInsertionPoint();
    if (!insertionPoint) {
      return;
    }

    const { owner, repo } = repoInfo;
    const branch = getCurrentBranch();
    const sshUrl = getSSHUrl(owner, repo);
    
    const button = createLauncherButton(() => {
      // Re-fetch branch in case user changed it
      const currentBranch = getCurrentBranch();
      const launcherUrl = buildLauncherUrl(sshUrl, currentBranch);
      window.open(launcherUrl, '_blank');
    });

    // Insert button
    if (insertionPoint.classList.contains('BtnGroup')) {
      // Insert inside button group
      insertionPoint.appendChild(button);
    } else if (insertionPoint.matches('.file-navigation, .pagehead-actions')) {
      // Insert at the end
      insertionPoint.appendChild(button);
    } else {
      // Insert after the Code button
      insertionPoint.parentNode.insertBefore(button, insertionPoint.nextSibling);
    }

    injected = true;
  }

  /**
   * Watch for DOM changes (SPA navigation)
   */
  function watchForChanges() {
    const observer = new MutationObserver((mutations) => {
      // Check if our button was removed (page navigation)
      if (injected && !document.getElementById(BUTTON_ID)) {
        injected = false;
      }
      
      // Try to inject if not present
      if (!injected) {
        injectButton();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initial injection
  injectButton();

  // Watch for SPA navigation
  watchForChanges();

  // Also try on popstate (back/forward navigation)
  window.addEventListener('popstate', () => {
    injected = false;
    setTimeout(injectButton, 100);
  });

})();
