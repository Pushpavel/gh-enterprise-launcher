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

  const BUTTON_ID = 'devcontainer-launcher-btn';

  /**
   * Determine the current page context
   * Returns: 'code-tab' | 'file-view' | 'pr-file-view' | 'excluded' | null
   */
  function getPageContext() {
    const path = location.pathname;
    const pathParts = path.split('/').filter(Boolean);
    
    // Need at least owner/repo
    if (pathParts.length < 2) {
      return null;
    }

    // Skip non-repo top-level pages
    const nonRepoPages = ['settings', 'organizations', 'users', 'search', 'notifications', 'login', 'logout', 'explore', 'marketplace', 'sponsors'];
    if (nonRepoPages.includes(pathParts[0])) {
      return null;
    }

    // Check for explicitly excluded pages (issues list, PR list, projects, etc.)
    const excludedSections = ['issues', 'projects', 'wiki', 'pulse', 'graphs', 'network', 'settings', 'security', 'actions', 'discussions'];
    if (pathParts.length >= 3) {
      const section = pathParts[2];
      
      // Issues/projects/wiki list pages - exclude
      if (excludedSections.includes(section)) {
        return 'excluded';
      }
      
      // Pull requests
      if (section === 'pull' || section === 'pulls') {
        // Check if we're viewing a specific PR with files
        // Pattern: /owner/repo/pull/123/files or /owner/repo/pull/123/files/path
        if (pathParts.length >= 5 && pathParts[4] === 'files') {
          return 'pr-file-view';
        }
        // PR conversation/commits pages - we can inject in header if viewing the PR detail
        if (pathParts.length >= 4 && /^\d+$/.test(pathParts[3])) {
          return 'pr-detail';
        }
        // PR list page - exclude
        return 'excluded';
      }
    }

    // File blob view: /owner/repo/blob/branch/path
    if (pathParts.length >= 4 && pathParts[2] === 'blob') {
      return 'file-view';
    }

    // Tree view (directory): /owner/repo/tree/branch/path
    if (pathParts.length >= 4 && pathParts[2] === 'tree') {
      return 'code-tab';
    }

    // Root repo page (no section or "Code" tab): /owner/repo
    if (pathParts.length === 2) {
      return 'code-tab';
    }

    // Commits view is okay for injection
    if (pathParts.length >= 3 && pathParts[2] === 'commits') {
      return 'code-tab';
    }

    // Default to code-tab for unrecognized repo subpages
    // But be conservative - only if there's a file-navigation element
    return 'code-tab';
  }

  /**
   * Extract repository info from the current page URL
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

    // Try to extract from URL for /tree/branch or /blob/branch paths
    const match = location.pathname.match(/\/(tree|blob)\/([^/]+)/);
    if (match) {
      return match[2];
    }

    // For PR file views, try to get the head branch
    const prBranchEl = document.querySelector('.head-ref a, .commit-ref.head-ref');
    if (prBranchEl) {
      const text = prBranchEl.textContent?.trim();
      if (text) return text;
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
  function createLauncherButton(onClick, variant = 'default') {
    const btn = document.createElement('a');
    btn.id = BUTTON_ID;
    btn.href = '#';
    btn.setAttribute('role', 'button');
    
    // Apply variant-specific classes
    if (variant === 'compact') {
      btn.className = 'btn btn-sm devcontainer-launcher-btn devcontainer-launcher-btn--compact';
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="octicon" aria-hidden="true">
          <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
        </svg>
        <span class="devcontainer-launcher-btn__text">Devcontainer</span>
      `;
    } else {
      btn.className = 'btn btn-primary devcontainer-launcher-btn';
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 4px; vertical-align: text-bottom;">
          <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
        </svg>
        Launch Devcontainer
      `;
    }
    
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    
    return btn;
  }

  /**
   * Find insertion point for Code tab (main repo view)
   * Targets the area near the green "Code" button
   */
  function findCodeTabInsertionPoint() {
    // Primary: Look for the "Code" dropdown button area
    const codeButtonSelectors = [
      // GHE 3.14+ Code button container
      '[data-testid="code-button"]',
      'get-repo',
      'details.get-repo-select-menu',
      // The green Code button's parent container
      '.file-navigation .BtnGroup:has(summary.btn-primary)',
      '.file-navigation .d-flex:has([data-testid="code-button"])',
      '.file-navigation details:has(summary.btn-primary)',
    ];

    for (const selector of codeButtonSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          return { element: el, position: 'after' };
        }
      } catch (e) {
        // :has() may not be supported in older browsers, continue
      }
    }

    // Fallback: file-navigation bar, but only if we're on a Code-like page
    const fileNav = document.querySelector('.file-navigation');
    if (fileNav) {
      // Verify this looks like a code tab (has branch selector or Code button)
      const hasBranchSelector = fileNav.querySelector('[data-hotkey="w"], .branch-select-menu, #branch-select-menu');
      const hasCodeButton = fileNav.querySelector('get-repo, [data-testid="code-button"], .get-repo-select-menu');
      
      if (hasBranchSelector || hasCodeButton) {
        // Find the right-side actions area
        const actionsArea = fileNav.querySelector('.flex-self-end, .d-flex.gap-2, .BtnGroup');
        if (actionsArea) {
          return { element: actionsArea, position: 'inside' };
        }
        return { element: fileNav, position: 'append' };
      }
    }

    return null;
  }

  /**
   * Find insertion point for file blob view
   * Targets the area near Raw/Blame/Edit buttons
   */
  function findFileViewInsertionPoint() {
    // File header actions (Raw, Blame, Edit buttons)
    const fileHeaderSelectors = [
      // Modern GHE: file header with actions
      '.Box-header .d-flex:has([data-testid="raw-button"])',
      '.Box-header .BtnGroup',
      '.blob-wrapper .file-actions',
      '.file-header .file-actions',
      // File view toolbar
      '.js-file-header .BtnGroup',
      '.file-info .BtnGroup',
      // Raw button's container
      '[data-testid="raw-button"]',
      'a[href*="/raw/"]',
    ];

    for (const selector of fileHeaderSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          // If we found a specific button, get its parent container
          if (el.matches('a, button')) {
            const parent = el.closest('.BtnGroup, .d-flex, .file-actions');
            if (parent) {
              return { element: parent, position: 'inside' };
            }
            return { element: el, position: 'after' };
          }
          return { element: el, position: 'inside' };
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  /**
   * Find insertion point for PR file view
   * Targets the PR header area or file diff header, avoiding status badges
   */
  function findPRFileViewInsertionPoint() {
    // PR header actions area (NOT the status line with Open/Merged badge)
    const prHeaderSelectors = [
      // PR header right-side actions (Edit button area)
      '.gh-header-actions',
      '.gh-header-meta .flex-md-row-reverse',
      // PR page header toolbar
      '.tabnav-tabs + .float-right',
      '.pr-toolbar .BtnGroup',
      // Review changes button area
      '#review-changes-modal + .BtnGroup',
      '[data-testid="review-changes-button"]',
    ];

    for (const selector of prHeaderSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          // Make sure we're not in the status badge area
          const isStatusArea = el.closest('.State, .IssueLabel, .gh-header-title');
          if (!isStatusArea) {
            return { element: el, position: 'prepend', variant: 'compact' };
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Fallback: try to find any suitable actions container in the PR header
    const prHeader = document.querySelector('.gh-header');
    if (prHeader) {
      const actionsContainer = prHeader.querySelector('.flex-md-row-reverse, .gh-header-actions, .float-right .BtnGroup');
      if (actionsContainer) {
        return { element: actionsContainer, position: 'prepend', variant: 'compact' };
      }
    }

    return null;
  }

  /**
   * Find insertion point for PR detail (conversation) page
   */
  function findPRDetailInsertionPoint() {
    // Similar to PR file view, but in the header
    const selectors = [
      '.gh-header-actions',
      '.gh-header-meta .float-right',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        const isStatusArea = el.closest('.State, .IssueLabel');
        if (!isStatusArea) {
          return { element: el, position: 'prepend', variant: 'compact' };
        }
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

    const context = getPageContext();
    
    // Don't inject on excluded pages
    if (!context || context === 'excluded') {
      return;
    }

    const repoInfo = getRepoInfo();
    if (!repoInfo) {
      return;
    }

    // Find appropriate insertion point based on context
    let insertionInfo;
    switch (context) {
      case 'code-tab':
        insertionInfo = findCodeTabInsertionPoint();
        break;
      case 'file-view':
        insertionInfo = findFileViewInsertionPoint();
        break;
      case 'pr-file-view':
        insertionInfo = findPRFileViewInsertionPoint();
        break;
      case 'pr-detail':
        insertionInfo = findPRDetailInsertionPoint();
        break;
      default:
        return;
    }

    if (!insertionInfo) {
      return;
    }

    const { element, position, variant = 'default' } = insertionInfo;
    const { owner, repo } = repoInfo;
    const branch = getCurrentBranch();
    const sshUrl = getSSHUrl(owner, repo);
    
    const button = createLauncherButton(() => {
      // Re-fetch branch in case user changed it
      const currentBranch = getCurrentBranch();
      const launcherUrl = buildLauncherUrl(sshUrl, currentBranch);
      window.open(launcherUrl, '_blank');
    }, variant);

    // Insert button based on position strategy
    switch (position) {
      case 'after':
        element.parentNode.insertBefore(button, element.nextSibling);
        break;
      case 'prepend':
        element.insertBefore(button, element.firstChild);
        break;
      case 'inside':
      case 'append':
      default:
        element.appendChild(button);
        break;
    }
  }

  /**
   * Remove existing button (for re-injection on navigation)
   */
  function removeButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (existing) {
      existing.remove();
    }
  }

  /**
   * Watch for DOM changes (SPA navigation)
   */
  function watchForChanges() {
    let debounceTimer;
    
    const observer = new MutationObserver((mutations) => {
      // Debounce rapid mutations
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Check if our button was removed (page navigation)
        if (!document.getElementById(BUTTON_ID)) {
          injectButton();
        }
      }, 100);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initial injection (with small delay for SPA hydration)
  setTimeout(injectButton, 100);

  // Watch for SPA navigation
  watchForChanges();

  // Handle back/forward navigation
  window.addEventListener('popstate', () => {
    removeButton();
    setTimeout(injectButton, 100);
  });

  // Handle turbo/pjax navigation (GitHub uses turbo)
  document.addEventListener('turbo:load', () => {
    removeButton();
    setTimeout(injectButton, 100);
  });
  
  document.addEventListener('pjax:end', () => {
    removeButton();
    setTimeout(injectButton, 100);
  });

})();
