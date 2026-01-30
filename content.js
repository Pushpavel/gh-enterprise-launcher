// Content script for GitHub Enterprise Devcontainer Launcher

(async function() {
  'use strict';

  // Load settings from storage
  const settings = await chrome.storage.sync.get(['gheUrl', 'launcherUrl', 'coderUrl', 'coderApiToken']);
  
  // Exit if not configured
  if (!settings.gheUrl) {
    return;
  }

  // Exit if current page doesn't match configured GHE URL
  const gheOrigin = new URL(settings.gheUrl).origin;
  if (location.origin !== gheOrigin) {
    return;
  }

  const BUTTON_ID = 'devcontainer-launcher-btn';
  const hasCoderApi = !!(settings.coderUrl && settings.coderApiToken);

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
   * For PR pages, extracts the "from" branch (head branch)
   */
  function getCurrentBranch() {
    const context = getPageContext();
    
    // Special handling for PR pages - extract the "from" branch
    if (context === 'pr-detail' || context === 'pr-file-view') {
      const prBranch = getPRHeadBranch();
      if (prBranch) {
        return prBranch;
      }
    }
    
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

    // Default to main/master
    return 'main';
  }

  /**
   * Extract the PR head branch ("from" branch)
   * Handles: "p.janakirama wants to merge ... into main from mongo"
   */
  function getPRHeadBranch() {
    // Method 1: Look for .commit-ref elements in .gh-header-meta
    // The head (from) branch is typically the second .commit-ref or has class .head-ref
    const headRefSelectors = [
      '.gh-header-meta .head-ref a',
      '.gh-header-meta .head-ref',
      '.gh-header-meta .commit-ref.head-ref a',
      '.gh-header-meta .commit-ref.head-ref',
    ];
    
    for (const selector of headRefSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text) {
          // Remove owner prefix if present (e.g., "owner:branch" -> "branch")
          return text.includes(':') ? text.split(':').pop() : text;
        }
      }
    }
    
    // Method 2: Find all .commit-ref in .gh-header-meta, the second one is usually head branch
    const commitRefs = document.querySelectorAll('.gh-header-meta .commit-ref');
    if (commitRefs.length >= 2) {
      const headRef = commitRefs[1]; // Second ref is the "from" branch
      const text = headRef.textContent?.trim();
      if (text) {
        return text.includes(':') ? text.split(':').pop() : text;
      }
    }
    
    // Method 3: Parse the "into X from Y" text pattern
    const headerMeta = document.querySelector('.gh-header-meta');
    if (headerMeta) {
      const text = headerMeta.textContent || '';
      // Match "from <branch>" pattern - the branch is typically the last word after "from"
      const fromMatch = text.match(/from\s+(\S+)\s*$/i);
      if (fromMatch) {
        return fromMatch[1];
      }
      
      // Alternative: look for anchor tag immediately after "from" text
      const walker = document.createTreeWalker(headerMeta, NodeFilter.SHOW_TEXT, null, false);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.includes('from')) {
          // Check if next sibling is an anchor with branch name
          let sibling = walker.currentNode.nextSibling;
          while (sibling) {
            if (sibling.nodeType === Node.ELEMENT_NODE) {
              const anchor = sibling.tagName === 'A' ? sibling : sibling.querySelector?.('a');
              if (anchor) {
                const branchText = anchor.textContent?.trim();
                if (branchText && !branchText.includes(' ')) {
                  return branchText.includes(':') ? branchText.split(':').pop() : branchText;
                }
              }
            }
            sibling = sibling.nextSibling;
          }
        }
      }
    }
    
    // Method 4: Look in PR comparison header
    const compareSelectors = [
      '.range-editor .head-ref',
      '.compare .head-ref',
      '[data-pjax="#js-repo-pjax-container"] .head-ref',
    ];
    
    for (const selector of compareSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text) {
          return text.includes(':') ? text.split(':').pop() : text;
        }
      }
    }
    
    return null;
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
  function buildLauncherUrl(owner, repo, sshUrl, branch) {
    return settings.launcherUrl
      .replace(/\{ssh_url\}/g, encodeURIComponent(sshUrl))
      .replace(/\{branch\}/g, encodeURIComponent(branch))
      .replace(/\{repo\}/g, encodeURIComponent(repo))
      .replace(/\{owner\}/g, encodeURIComponent(owner));
  }

  /**
   * Check workspace status via background script
   */
  async function checkWorkspaceStatus(repo, branch) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'CHECK_WORKSPACE', repo, branch },
        (response) => {
          resolve(response || { status: 'error', error: 'No response' });
        }
      );
    });
  }

  /**
   * Create the launcher button element with smart states
   */
  function createLauncherButton(repoInfo, variant = 'default') {
    const { owner, repo } = repoInfo;
    const btn = document.createElement('a');
    btn.id = BUTTON_ID;
    btn.href = '#';
    btn.setAttribute('role', 'button');
    
    // Start with standard gray btn look (loading state)
    if (variant === 'compact') {
      btn.className = 'btn btn-sm devcontainer-launcher-btn devcontainer-launcher-btn--compact devcontainer-launcher-btn--loading';
    } else {
      btn.className = 'btn devcontainer-launcher-btn devcontainer-launcher-btn--loading';
    }
    
    // Initial loading state
    setButtonState(btn, 'loading', variant);
    
    // Check workspace status
    const branch = getCurrentBranch();
    
    if (hasCoderApi) {
      // Use Coder API to check workspace
      checkWorkspaceStatus(repo, branch).then((result) => {
        btn.classList.remove('devcontainer-launcher-btn--loading');
        
        if (result.status === 'found') {
          setButtonState(btn, 'found', variant, result);
          btn.onclick = (e) => {
            e.preventDefault();
            window.open(result.workspaceUrl, '_blank');
          };
        } else if (result.status === 'missing') {
          setButtonState(btn, 'missing', variant, result);
          btn.onclick = (e) => {
            e.preventDefault();
            const currentBranch = getCurrentBranch();
            const sshUrl = getSSHUrl(owner, repo);
            const launcherUrl = buildLauncherUrl(owner, repo, sshUrl, currentBranch);
            window.open(launcherUrl, '_blank');
          };
        } else if (result.status === 'unconfigured') {
          // Fall back to simple launcher
          setButtonState(btn, 'default', variant);
          btn.onclick = (e) => {
            e.preventDefault();
            const currentBranch = getCurrentBranch();
            const sshUrl = getSSHUrl(owner, repo);
            const launcherUrl = buildLauncherUrl(owner, repo, sshUrl, currentBranch);
            window.open(launcherUrl, '_blank');
          };
        } else {
          // Error state - show default with error tooltip
          setButtonState(btn, 'error', variant, result);
          btn.onclick = (e) => {
            e.preventDefault();
            const currentBranch = getCurrentBranch();
            const sshUrl = getSSHUrl(owner, repo);
            const launcherUrl = buildLauncherUrl(owner, repo, sshUrl, currentBranch);
            window.open(launcherUrl, '_blank');
          };
        }
      });
    } else {
      // No Coder API - use simple launcher mode
      btn.classList.remove('devcontainer-launcher-btn--loading');
      setButtonState(btn, 'default', variant);
      btn.onclick = (e) => {
        e.preventDefault();
        const currentBranch = getCurrentBranch();
        const sshUrl = getSSHUrl(owner, repo);
        const launcherUrl = buildLauncherUrl(owner, repo, sshUrl, currentBranch);
        window.open(launcherUrl, '_blank');
      };
    }
    
    return btn;
  }

  /**
   * Set button visual state
   * Uses standard gray btn for all states EXCEPT 'found' which uses green btn-primary
   */
  function setButtonState(btn, state, variant, data = {}) {
    // Remove all state classes
    btn.classList.remove(
      'devcontainer-launcher-btn--loading',
      'devcontainer-launcher-btn--found',
      'devcontainer-launcher-btn--missing',
      'devcontainer-launcher-btn--error',
      'btn-primary'
    );
    
    const isCompact = variant === 'compact';
    const iconSize = 16; // Consistent 16x16 icons
    
    // Icon with proper alignment
    const iconStyle = 'vertical-align: text-bottom; flex-shrink: 0;';
    
    switch (state) {
      case 'loading':
        btn.classList.add('devcontainer-launcher-btn--loading');
        btn.innerHTML = `
          <span class="devcontainer-launcher-spinner"></span>
          ${isCompact ? '<span class="devcontainer-launcher-btn__text">Checking...</span>' : 'Checking...'}
        `;
        btn.title = 'Checking for existing workspace...';
        break;
        
      case 'found':
        // SUCCESS STATE: Green btn-primary
        btn.classList.add('devcontainer-launcher-btn--found', 'btn-primary');
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 16 16" fill="currentColor" class="octicon" aria-hidden="true" style="${iconStyle}">
            <path d="M8.22 2.97a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l2.97-2.97H3.75a.75.75 0 0 1 0-1.5h7.44L8.22 4.03a.75.75 0 0 1 0-1.06Z"/>
          </svg>
          ${isCompact ? '<span class="devcontainer-launcher-btn__text">Open Workspace</span>' : 'Open Workspace'}
        `;
        btn.title = data.workspaceName ? `Open workspace: ${data.workspaceName}` : 'Open existing workspace';
        break;
        
      case 'missing':
        // Standard gray button for create
        btn.classList.add('devcontainer-launcher-btn--missing');
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 16 16" fill="currentColor" class="octicon" aria-hidden="true" style="${iconStyle}">
            <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/>
          </svg>
          ${isCompact ? '<span class="devcontainer-launcher-btn__text">Create Workspace</span>' : 'Create Workspace'}
        `;
        btn.title = data.workspaceName ? `Create workspace: ${data.workspaceName}` : 'Create new workspace';
        break;
        
      case 'error':
        // Standard gray button with git-fork icon
        btn.classList.add('devcontainer-launcher-btn--error');
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 16 16" fill="currentColor" class="octicon" aria-hidden="true" style="${iconStyle}">
            <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
          </svg>
          ${isCompact ? '<span class="devcontainer-launcher-btn__text">Devcontainer</span>' : 'Launch Devcontainer'}
        `;
        btn.title = data.error ? `Error: ${data.error}. Click to launch anyway.` : 'Launch devcontainer';
        break;
        
      case 'default':
      default:
        // Standard gray button
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 16 16" fill="currentColor" class="octicon" aria-hidden="true" style="${iconStyle}">
            <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
          </svg>
          ${isCompact ? '<span class="devcontainer-launcher-btn__text">Devcontainer</span>' : 'Launch Devcontainer'}
        `;
        btn.title = 'Launch devcontainer';
        break;
    }
  }

  /**
   * Find insertion point for Code tab (main repo view)
   * Uses Gitpod-style robust selectors for GHE 3.14 compatibility
   * Handles both legacy file-navigation UI and new React-based UI
   */
  function findCodeTabInsertionPoint() {
    // Strategy 1: New React-based UI (GHE 3.14+ / GitHub dotcom new UI)
    // Gitpod uses: xpath://*[contains(@id, 'repo-content-')]/div/div/div/div[1]/react-partial/div/div/div[2]/div[2]
    // We'll use CSS selectors that target the same structure
    const reactUISelectors = [
      // React partial container - the action buttons row
      '[id^="repo-content-"] react-partial [class*="Box-sc-"] > div:last-child',
      '[id^="repo-content-"] .react-directory-commit-age + div',
      // Direct targeting of the button group near Code button in React UI
      '[id*="repo-content"] div[class*="gtBUEp"]',
      '[id*="repo-content"] div[class*="Box-sc-"]',
    ];

    for (const selector of reactUISelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && !document.querySelector('.file-navigation')) {
          // React UI - insert in the actions area
          return { element: el, position: 'prepend' };
        }
      } catch (e) {
        continue;
      }
    }

    // Strategy 2: Legacy file-navigation UI (older GHE versions)
    // Target the "Go to file" button area (data-hotkey="t") as Gitpod does
    const fileNav = document.querySelector('.file-navigation');
    if (fileNav) {
      // Priority 1: Find the "Go to file" button with data-hotkey="t" (Gitpod-style)
      const goToFileBtn = fileNav.querySelector('a[data-hotkey="t"], button[data-hotkey="t"]');
      if (goToFileBtn) {
        const parent = goToFileBtn.closest('.BtnGroup, .d-flex, .gap-2') || goToFileBtn.parentElement;
        if (parent) {
          return { element: parent, position: 'after' };
        }
      }

      // Priority 2: Find the Code dropdown button (green button)
      const codeButtonSelectors = [
        'get-repo',                                    // Custom element for Code dropdown
        'details.get-repo-select-menu',                // Legacy Code dropdown
        '[data-testid="code-button"]',                 // New testid-based
        'summary.btn-primary[data-ga-click*="Code"]',  // GA tracking attribute
        'summary.btn-primary',                         // Generic green button
        'details:has(summary.btn-primary)',            // Details containing green button
      ];

      for (const selector of codeButtonSelectors) {
        try {
          const codeBtn = fileNav.querySelector(selector);
          if (codeBtn) {
            // Insert before the Code button for visibility
            return { element: codeBtn, position: 'before' };
          }
        } catch (e) {
          continue;
        }
      }

      // Priority 3: Action group containers in file-navigation
      const actionSelectors = [
        '.file-navigation-options',
        '.d-flex.gap-2.flex-1.flex-justify-end',
        '.d-flex.flex-justify-end',
        '.flex-self-end.d-flex',
        '.BtnGroup + .BtnGroup',
        '.BtnGroup',
        '.d-md-flex.flex-justify-end',
      ];
      
      for (const selector of actionSelectors) {
        const actionsArea = fileNav.querySelector(selector);
        if (actionsArea) {
          return { element: actionsArea, position: 'prepend' };
        }
      }
      
      // Fallback: append to file-navigation itself (rightmost position)
      return { element: fileNav, position: 'append' };
    }

    // Strategy 3: Look for repository content containers
    const repoContentSelectors = [
      '#repo-content-pjax-container',
      '#repo-content-turbo-frame',
      '[id^="repo-content-"]',
      '.repository-content',
    ];

    for (const selector of repoContentSelectors) {
      const repoContent = document.querySelector(selector);
      if (repoContent) {
        // Look for action button containers within
        const innerSelectors = [
          '.d-flex.gap-2',
          '.d-flex.flex-justify-end', 
          '.Box-header .d-flex',
          '.file-navigation',
        ];
        
        for (const innerSelector of innerSelectors) {
          const container = repoContent.querySelector(innerSelector);
          if (container) {
            return { element: container, position: 'prepend' };
          }
        }
      }
    }

    // Strategy 4: XPath fallback for deeply nested React components (Gitpod-style)
    try {
      const xpathResult = document.evaluate(
        "//*[contains(@id, 'repo-content-')]/div/div/div/div[1]//div[contains(@class, 'd-flex')]",
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      if (xpathResult.singleNodeValue) {
        return { element: xpathResult.singleNodeValue, position: 'prepend' };
      }
    } catch (e) {
      // XPath not supported or failed
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
   * With retry logic for async DOM changes
   */
  function injectButton(retryCount = 0) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 200;

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

    // Check if we have launcher URL configured
    if (!settings.launcherUrl && !hasCoderApi) {
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
      // Retry if we haven't exceeded max retries (DOM might not be ready)
      if (retryCount < MAX_RETRIES) {
        setTimeout(() => injectButton(retryCount + 1), RETRY_DELAY);
      }
      return;
    }

    const { element, position, variant = 'default' } = insertionInfo;
    
    // Double-check the element is still in the DOM
    if (!document.body.contains(element)) {
      if (retryCount < MAX_RETRIES) {
        setTimeout(() => injectButton(retryCount + 1), RETRY_DELAY);
      }
      return;
    }
    
    const button = createLauncherButton(repoInfo, variant);

    // Insert button based on position strategy
    switch (position) {
      case 'before':
        element.parentNode.insertBefore(button, element);
        break;
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
    let lastUrl = location.href;
    
    const observer = new MutationObserver((mutations) => {
      // Debounce rapid mutations
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Check if URL changed (SPA navigation)
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
          lastUrl = currentUrl;
          removeButton();
        }
        
        // Check if our button was removed (page navigation or DOM update)
        if (!document.getElementById(BUTTON_ID)) {
          injectButton();
        }
      }, 150);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initial injection (with small delay for SPA hydration)
  setTimeout(() => injectButton(), 100);

  // Watch for SPA navigation
  watchForChanges();

  // Handle back/forward navigation
  window.addEventListener('popstate', () => {
    removeButton();
    setTimeout(() => injectButton(), 100);
  });

  // Handle turbo/pjax/turbo-frame navigation (GitHub/GHE uses these)
  document.addEventListener('turbo:load', () => {
    removeButton();
    setTimeout(() => injectButton(), 100);
  });
  
  document.addEventListener('turbo:frame-load', () => {
    removeButton();
    setTimeout(() => injectButton(), 100);
  });
  
  document.addEventListener('pjax:end', () => {
    removeButton();
    setTimeout(() => injectButton(), 100);
  });

})();
