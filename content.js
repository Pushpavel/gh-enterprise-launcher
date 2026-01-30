// Content script for GitHub Enterprise Devcontainer Launcher
// v2.0.5 - Hotfix: commit hash as branch, robust injection, name placeholder

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

  // ============================================================================
  // BUTTON CONTRIBUTION STRATEGIES (Gitpod-style)
  // ============================================================================
  
  /**
   * Button contribution strategies - modeled after Gitpod's button-contributions.ts
   * Each strategy targets a specific page type with robust selectors.
   */
  const buttonContributions = [
    // ---------------------------------------------------------------------
    // gh-repo: Main repository view (Code tab, tree navigation)
    // Uses react-partial XPath for new GitHub UI
    // ---------------------------------------------------------------------
    {
      id: 'gh-repo',
      match: () => {
        const regex = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)(\/(tree\/.*)?)?$/;
        // New React UI: file-navigation is absent
        return document.querySelector('div.file-navigation') === null && regex.test(window.location.href);
      },
      // Gitpod's exact XPath for new React UI
      selector: `xpath://*[contains(@id, 'repo-content-')]/div/div/div/div[1]/react-partial/div/div/div[2]/div[2]`,
      fallbackSelectors: [
        // Fallback CSS selectors for the same area
        '[id^="repo-content-"] react-partial [class*="Box-sc-"] > div:last-child',
        '[id^="repo-content-"] .react-directory-commit-age + div',
      ],
      containerProps: {
        display: 'inline-flex',
        marginRight: '8px',
        verticalAlign: 'middle',
      },
      position: 'prepend',
      variant: 'default',
      additionalClassNames: ['medium'],
      manipulations: [
        {
          // Make the "Code" button secondary (remove primary styling)
          selector: `xpath://button[contains(., 'Code')]`,
          setAttribute: [{ name: 'data-variant', value: 'default' }],
        },
      ],
    },
    
    // ---------------------------------------------------------------------
    // gh-repo-legacy: Legacy file-navigation UI (older GHE versions)
    // ---------------------------------------------------------------------
    {
      id: 'gh-repo-legacy',
      match: () => {
        return document.querySelector('div.file-navigation') !== null;
      },
      selector: '.file-navigation',
      containerProps: {
        display: 'inline-flex',
        marginLeft: '8px',
        verticalAlign: 'middle',
        float: 'left',
      },
      // Insert after the "Go to file" button (Gitpod-style)
      insertBefore: 'get-repo, details.get-repo-select-menu, [data-testid="code-button"], summary.btn-primary',
      position: 'inside-before',
      variant: 'default',
    },

    // ---------------------------------------------------------------------
    // gh-file: File blob view (viewing a single file)
    // Targets the sticky header with Raw/Blame/Edit buttons
    // ---------------------------------------------------------------------
    {
      id: 'gh-file',
      match: /\/blob\//,
      selector: '#StickyHeader > div > div > div.Box-sc-g0xbh4-0.gtBUEp',
      fallbackSelectors: [
        '.Box-header .d-flex:has([data-testid="raw-button"])',
        '.Box-header .BtnGroup',
        '.blob-wrapper .file-actions',
        '.file-header .file-actions',
      ],
      containerProps: {
        display: 'inline-flex',
        marginLeft: '8px',
      },
      position: 'append',
      variant: 'default',
      additionalClassNames: ['medium'],
    },

    // ---------------------------------------------------------------------
    // gh-pull: Pull request pages (conversation, commits, files)
    // ---------------------------------------------------------------------
    {
      id: 'gh-pull',
      match: /\/pull\//,
      selector: '#partial-discussion-header div.gh-header-show > div > div',
      fallbackSelectors: [
        '.gh-header-actions',
        '.gh-header-meta .flex-md-row-reverse',
      ],
      containerProps: {
        display: 'inline-flex',
        order: '2',
        marginRight: '8px',
      },
      position: 'prepend',
      variant: 'compact',
    },

    // ---------------------------------------------------------------------
    // gh-pull-prx_files: New PR review experience (files tab)
    // ---------------------------------------------------------------------
    {
      id: 'gh-pull-prx_files',
      match: /\/pull\/.*\/files/,
      selector: "div[data-component='PH_Actions']",
      containerProps: {
        display: 'inline-flex',
        order: '2',
        marginRight: '8px',
      },
      position: 'prepend',
      variant: 'compact',
    },

    // ---------------------------------------------------------------------
    // gh-issue: Issue pages
    // ---------------------------------------------------------------------
    {
      id: 'gh-issue',
      match: /\/issues\//,
      selector: "[data-component='PH_Actions'] > div",
      insertBefore: "[data-component='PH_Actions'] > div > button",
      fallbackSelectors: [
        `xpath://*[@id="js-repo-pjax-container"]/react-app/div/div/div/div/div[1]/div/div/div[3]/div`,
      ],
      containerProps: {
        display: 'inline-flex',
        marginRight: '8px',
      },
      position: 'inside-before',
      variant: 'default',
      additionalClassNames: ['tall'],
    },

    // ---------------------------------------------------------------------
    // gh-commit: Commit detail page
    // Targets the area near "Browse files" button for consistent placement
    // Uses XPath to find the parent of "Browse files" link as most robust option
    // ---------------------------------------------------------------------
    {
      id: 'gh-commit',
      match: /\/commit\//,
      // Primary: XPath to find parent of "Browse files" link (most robust)
      selector: `xpath://a[contains(., 'Browse files')]/..`,
      fallbackSelectors: [
        // Alternative XPath: parent of Browse files with data-testid
        `xpath://a[@data-testid='browse-at-time-link']/..`,
        // The commit-meta bar (contains Browse files, parent commits, etc.)
        '.commit-meta',
        '.full-commit .commit-meta',
        '.commit.full-commit .commit-meta',
        // File navigation if present
        '.file-navigation',
        // Container with Browse files link (CSS :has)
        '.full-commit div:has(> a[href*="/tree/"])',
        'div:has(> #browse-at-time-link)',
        // React-based commit view
        '[id^="repo-content-"] .commit-tease',
        '[id^="repo-content-"] div:has(> a[data-testid="browse-at-time-link"])',
        // Gitpod's selector for the full-commit container
        '#repo-content-pjax-container > div > div.commit.full-commit.mt-0.px-2.pt-2',
        // Broader fallback: the commit header area
        '#repo-content-pjax-container .full-commit',
        '#repo-content-turbo-frame .full-commit',
      ],
      // Try to insert before the "Browse files" link
      insertBefore: '#browse-at-time-link, a[href*="/tree/"][data-testid], a.btn[href*="/tree/"], a:has-text("Browse files")',
      containerProps: {
        display: 'inline-flex',
        float: 'none',
        marginLeft: '0',
        marginRight: '8px',
      },
      position: 'prepend',
      variant: 'default',
      additionalClassNames: ['medium'],
    },

    // ---------------------------------------------------------------------
    // gh-empty-repo: Empty repository setup page
    // ---------------------------------------------------------------------
    {
      id: 'gh-empty-repo',
      match: () => {
        return document.querySelector('.blankslate') !== null || 
               document.querySelector('[data-testid="empty-repo"]') !== null;
      },
      selector: '#repo-content-pjax-container > div > div.d-md-flex.flex-items-stretch.gutter-md.mb-4 > div.col-md-6.mb-4.mb-md-0 > div, #repo-content-turbo-frame > div > div.d-md-flex.flex-items-stretch.gutter-md.mb-4 > div.col-md-6.mb-4.mb-md-0 > div',
      containerProps: {
        display: 'inline-flex',
        marginTop: '8px',
      },
      position: 'append',
      variant: 'default',
    },
  ];

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * Evaluate an XPath expression and return the first matching element
   */
  function evaluateXPath(xpath) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue;
    } catch (e) {
      return null;
    }
  }

  /**
   * Find element using selector (supports xpath: prefix like Gitpod)
   */
  function findElement(selector) {
    if (!selector) return null;
    
    if (selector.startsWith('xpath:')) {
      return evaluateXPath(selector.substring(6));
    }
    
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  }

  /**
   * Find the first matching element from a list of selectors
   */
  function findFirstMatch(selectors) {
    if (!selectors) return null;
    
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    
    for (const selector of selectorList) {
      const el = findElement(selector);
      if (el) return el;
    }
    
    return null;
  }

  /**
   * Check if a contribution matches the current page
   */
  function matchesPage(contribution) {
    const { match } = contribution;
    
    if (!match) return true;
    
    if (typeof match === 'function') {
      return match();
    }
    
    if (match instanceof RegExp) {
      return match.test(window.location.href);
    }
    
    return true;
  }

  /**
   * Apply manipulations from a contribution (e.g., demote Code button)
   */
  function applyManipulations(manipulations) {
    if (!manipulations) return;
    
    for (const manip of manipulations) {
      const el = findElement(manip.selector || manip.element);
      if (!el) continue;
      
      if (manip.removeClassName) {
        el.classList.remove(manip.removeClassName);
      }
      
      if (manip.addClassName) {
        el.classList.add(manip.addClassName);
      }
      
      if (manip.style) {
        Object.assign(el.style, manip.style);
      }
      
      if (manip.setAttribute) {
        for (const attr of manip.setAttribute) {
          el.setAttribute(attr.name, attr.value);
        }
      }
    }
  }

  /**
   * Find the best matching contribution for the current page
   */
  function findMatchingContribution() {
    // Sort by specificity (more specific matches first)
    // Contributions with function matchers or regex with more path components go first
    const sorted = [...buttonContributions].sort((a, b) => {
      // Prefer function matchers over regex
      if (typeof a.match === 'function' && typeof b.match !== 'function') return -1;
      if (typeof b.match === 'function' && typeof a.match !== 'function') return 1;
      return 0;
    });
    
    for (const contribution of sorted) {
      if (!matchesPage(contribution)) continue;
      
      // Try main selector
      let element = findElement(contribution.selector);
      
      // Try fallback selectors
      if (!element && contribution.fallbackSelectors) {
        element = findFirstMatch(contribution.fallbackSelectors);
      }
      
      if (element) {
        return { contribution, element };
      }
    }
    
    return null;
  }

  // ============================================================================
  // REPOSITORY INFO EXTRACTION
  // ============================================================================

  function getRepoInfo() {
    const pathParts = location.pathname.split('/').filter(Boolean);
    
    if (pathParts.length < 2) {
      return null;
    }

    const owner = pathParts[0];
    const repo = pathParts[1];
    
    // Skip non-repo pages
    const nonRepoPages = ['settings', 'organizations', 'users', 'search', 'notifications', 'login', 'logout', 'explore', 'marketplace', 'sponsors'];
    if (nonRepoPages.includes(owner)) {
      return null;
    }

    return { owner, repo };
  }

  /**
   * Extract current branch/ref from the page
   * For commit pages, returns the full commit SHA
   */
  function getCurrentBranch() {
    // Special handling for commit pages - use the commit SHA as the "branch"
    if (/\/commit\//.test(location.pathname)) {
      const commitMatch = location.pathname.match(/\/commit\/([a-f0-9]+)/i);
      if (commitMatch) {
        return commitMatch[1]; // Return full commit SHA
      }
    }
    
    // Special handling for PR pages - extract the "from" branch
    if (/\/pull\//.test(location.pathname)) {
      const prBranch = getPRHeadBranch();
      if (prBranch) return prBranch;
    }
    
    // Try various selectors used in different GHE versions
    const selectors = [
      '[data-hotkey="w"] span.Text-sc-17v1xeu-0',
      '[data-hotkey="w"] span[data-component="text"]',
      '#branch-select-menu summary span.css-truncate-target',
      'summary[title] span.css-truncate-target',
      '[data-testid="anchor-button"] span',
      'button[aria-label*="branch"] span',
      '.branch-select-menu summary span.css-truncate-target',
      '.ref-selector-button-text-container span',
      '[data-hotkey="w"]',
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

    return 'main';
  }

  function getPRHeadBranch() {
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
          return text.includes(':') ? text.split(':').pop() : text;
        }
      }
    }
    
    const commitRefs = document.querySelectorAll('.gh-header-meta .commit-ref');
    if (commitRefs.length >= 2) {
      const headRef = commitRefs[1];
      const text = headRef.textContent?.trim();
      if (text) {
        return text.includes(':') ? text.split(':').pop() : text;
      }
    }
    
    return null;
  }

  function getSSHUrl(owner, repo) {
    const gheHost = new URL(settings.gheUrl).host;
    return `git@${gheHost}:${owner}/${repo}.git`;
  }

  function buildLauncherUrl(owner, repo, sshUrl, branch) {
    // Generate workspace name: repo-branch (sanitized for use in URLs)
    const sanitizedBranch = branch.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const sanitizedRepo = repo.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const workspaceName = `${sanitizedRepo}-${sanitizedBranch}`.toLowerCase().substring(0, 32);
    
    return settings.launcherUrl
      .replace(/\{ssh_url\}/g, encodeURIComponent(sshUrl))
      .replace(/\{branch\}/g, encodeURIComponent(branch))
      .replace(/\{repo\}/g, encodeURIComponent(repo))
      .replace(/\{owner\}/g, encodeURIComponent(owner))
      .replace(/\{name\}/g, encodeURIComponent(workspaceName));
  }

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

  // ============================================================================
  // BUTTON CREATION
  // ============================================================================

  /**
   * Create the container element with proper inline-flex styling
   */
  function createContainer(containerProps, additionalClassNames = []) {
    const container = document.createElement('div');
    container.id = BUTTON_ID + '-container';
    
    // Apply Gitpod-style inline layout classes
    container.classList.add(
      'devcontainer-launcher-container',
      'd-inline-flex',
      'flex-items-center'
    );
    
    // Add any additional classes
    if (additionalClassNames.length > 0) {
      container.classList.add(...additionalClassNames.map(c => `devcontainer-launcher--${c}`));
    }
    
    // Apply inline styles from containerProps
    if (containerProps) {
      Object.assign(container.style, containerProps);
    }
    
    return container;
  }

  function createLauncherButton(repoInfo, variant = 'default') {
    const { owner, repo } = repoInfo;
    const btn = document.createElement('a');
    btn.id = BUTTON_ID;
    btn.href = '#';
    btn.setAttribute('role', 'button');
    
    if (variant === 'compact') {
      btn.className = 'btn btn-sm devcontainer-launcher-btn devcontainer-launcher-btn--compact devcontainer-launcher-btn--loading';
    } else {
      btn.className = 'btn devcontainer-launcher-btn devcontainer-launcher-btn--loading';
    }
    
    setButtonState(btn, 'loading', variant);
    
    const branch = getCurrentBranch();
    
    if (hasCoderApi) {
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
          setButtonState(btn, 'default', variant);
          btn.onclick = (e) => {
            e.preventDefault();
            const currentBranch = getCurrentBranch();
            const sshUrl = getSSHUrl(owner, repo);
            const launcherUrl = buildLauncherUrl(owner, repo, sshUrl, currentBranch);
            window.open(launcherUrl, '_blank');
          };
        } else {
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

  function setButtonState(btn, state, variant, data = {}) {
    btn.classList.remove(
      'devcontainer-launcher-btn--loading',
      'devcontainer-launcher-btn--found',
      'devcontainer-launcher-btn--missing',
      'devcontainer-launcher-btn--error',
      'btn-primary'
    );
    
    const isCompact = variant === 'compact';
    const iconSize = 16;
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

  // ============================================================================
  // INJECTION LOGIC
  // ============================================================================

  function injectButton(retryCount = 0) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 200;

    // Skip if already injected
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const repoInfo = getRepoInfo();
    if (!repoInfo) {
      return;
    }

    if (!settings.launcherUrl && !hasCoderApi) {
      return;
    }

    // Find matching contribution
    const match = findMatchingContribution();
    
    if (!match) {
      if (retryCount < MAX_RETRIES) {
        setTimeout(() => injectButton(retryCount + 1), RETRY_DELAY);
      }
      return;
    }

    const { contribution, element } = match;
    
    // Double-check the element is still in the DOM
    if (!document.body.contains(element)) {
      if (retryCount < MAX_RETRIES) {
        setTimeout(() => injectButton(retryCount + 1), RETRY_DELAY);
      }
      return;
    }

    // Apply any manipulations (e.g., demote Code button)
    applyManipulations(contribution.manipulations);

    // Create container with proper inline styling
    const container = createContainer(
      contribution.containerProps,
      contribution.additionalClassNames || []
    );
    
    // Create and add button to container
    const button = createLauncherButton(repoInfo, contribution.variant || 'default');
    container.appendChild(button);

    // Insert based on position strategy
    const { position, insertBefore } = contribution;
    
    if (position === 'inside-before' && insertBefore) {
      // Insert before a specific child element
      const beforeEl = findFirstMatch(insertBefore.split(', '));
      if (beforeEl && element.contains(beforeEl)) {
        element.insertBefore(container, beforeEl);
      } else {
        element.insertBefore(container, element.firstChild);
      }
    } else if (position === 'prepend') {
      element.insertBefore(container, element.firstChild);
    } else if (position === 'before') {
      element.parentNode.insertBefore(container, element);
    } else if (position === 'after') {
      element.parentNode.insertBefore(container, element.nextSibling);
    } else {
      // Default: append
      element.appendChild(container);
    }
  }

  function removeButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (existing) {
      existing.remove();
    }
    const container = document.getElementById(BUTTON_ID + '-container');
    if (container) {
      container.remove();
    }
  }

  function watchForChanges() {
    let debounceTimer;
    let lastUrl = location.href;
    
    const observer = new MutationObserver((mutations) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
          lastUrl = currentUrl;
          removeButton();
        }
        
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

  // Initial injection
  setTimeout(() => injectButton(), 100);

  // Watch for SPA navigation
  watchForChanges();

  // Handle back/forward navigation
  window.addEventListener('popstate', () => {
    removeButton();
    setTimeout(() => injectButton(), 100);
  });

  // Handle turbo/pjax navigation
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
