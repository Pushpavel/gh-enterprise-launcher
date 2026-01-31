// Background service worker for Coder API integration

/**
 * Derive workspace name from repo and branch
 * Coder workspace names: lowercase, alphanumeric + hyphens, max 32 chars
 */
function deriveWorkspaceName(repo, branch) {
  // Format: repo-branch, sanitized
  const combined = `${repo}-${branch}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')  // Replace invalid chars with hyphens
    .replace(/-+/g, '-')          // Collapse multiple hyphens
    .replace(/^-|-$/g, '')        // Trim leading/trailing hyphens
    .slice(0, 32);                // Max 32 chars

  return combined;
}

/**
 * Make authenticated Coder API request
 */
async function coderApiRequest(coderUrl, apiToken, endpoint) {
  const url = `${coderUrl}/api/v2${endpoint}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Coder-Session-Token': apiToken
    }
  });

  if (!response.ok) {
    const error = new Error(`API request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/**
 * Verify connection by checking /api/v2/users/me
 */
async function verifyConnection(coderUrl, apiToken) {
  try {
    const user = await coderApiRequest(coderUrl, apiToken, '/users/me');
    return {
      success: true,
      username: user.username,
      email: user.email
    };
  } catch (error) {
    return {
      success: false,
      error: error.status === 401 ? 'Invalid API token' :
        error.status === 404 ? 'Coder API not found at this URL' :
          `Connection failed: ${error.message}`
    };
  }
}

/**
 * Check if workspace exists for given repo/branch
 * Returns detailed status including build state for smart button display
 */
async function checkWorkspace(coderUrl, apiToken, repo, branch) {
  const workspaceName = deriveWorkspaceName(repo, branch);

  try {
    // Search for workspace by name
    const result = await coderApiRequest(
      coderUrl,
      apiToken,
      `/workspaces?q=name:${encodeURIComponent(workspaceName)}`
    );

    // Check if we found an exact match
    const workspace = result.workspaces?.find(ws => ws.name === workspaceName);

    if (workspace) {
      // Workspace exists - return URL to open it with detailed status
      const workspaceUrl = `${coderUrl}/@${workspace.owner_name}/${workspace.name}`;
      const latestBuild = workspace.latest_build;

      // Determine workspace state for smart button display
      // Status can be: pending, starting, running, stopping, stopped, failed, canceling, canceled, deleting, deleted
      let workspaceState = 'unknown';
      if (latestBuild) {
        const status = latestBuild.status;
        const transition = latestBuild.transition; // start, stop, delete

        if (status === 'running') {
          workspaceState = 'running';
        } else if (status === 'stopped') {
          workspaceState = 'stopped';
        } else if (status === 'starting' || status === 'pending') {
          workspaceState = 'starting';
        } else if (status === 'stopping') {
          workspaceState = 'stopping';
        } else if (status === 'failed') {
          workspaceState = 'failed';
        } else if (status === 'canceling' || status === 'canceled') {
          workspaceState = 'canceled';
        } else if (status === 'deleting' || status === 'deleted') {
          workspaceState = 'deleted';
        }
      }

      return {
        status: 'found',
        workspaceName: workspace.name,
        workspaceId: workspace.id,
        workspaceUrl: workspaceUrl,
        ownerName: workspace.owner_name,
        templateName: workspace.template_name,
        workspaceState: workspaceState,
        latestBuild: latestBuild?.status,
        lastUsedAt: workspace.last_used_at
      };
    } else {
      // Workspace doesn't exist - return URL to create it
      return {
        status: 'missing',
        workspaceName: workspaceName
      };
    }
  } catch (error) {
    return {
      status: 'error',
      error: error.status === 401 ? 'API token expired or invalid' :
        `Failed to check workspace: ${error.message}`
    };
  }
}

/**
 * Start a stopped workspace
 */
async function startWorkspace(coderUrl, apiToken, workspaceId) {
  try {
    const url = `${coderUrl}/api/v2/workspaces/${workspaceId}/builds`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Coder-Session-Token': apiToken
      },
      body: JSON.stringify({
        transition: 'start'
      })
    });

    if (!response.ok) {
      const error = new Error(`Start workspace failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.status === 401 ? 'API token expired or invalid' :
        `Failed to start workspace: ${error.message}`
    };
  }
}

/**
 * Stop a running workspace
 */
async function stopWorkspace(coderUrl, apiToken, workspaceId) {
  try {
    const url = `${coderUrl}/api/v2/workspaces/${workspaceId}/builds`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Coder-Session-Token': apiToken
      },
      body: JSON.stringify({
        transition: 'stop'
      })
    });

    if (!response.ok) {
      const error = new Error(`Stop workspace failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.status === 401 ? 'API token expired or invalid' :
        `Failed to stop workspace: ${error.message}`
    };
  }
}

/**
 * Get available templates
 */
async function getTemplates(coderUrl, apiToken) {
  try {
    const result = await coderApiRequest(coderUrl, apiToken, '/templates');
    return {
      success: true,
      templates: result.map(t => ({
        id: t.id,
        name: t.name,
        displayName: t.display_name || t.name,
        description: t.description,
        icon: t.icon
      }))
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Message handler for content script communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle async responses
  (async () => {
    try {
      // Get settings
      const settings = await chrome.storage.sync.get([
        'coderUrl', 'coderApiToken', 'launcherUrl', 'gheUrl'
      ]);

      switch (request.action) {
        case 'VERIFY_CONNECTION': {
          const result = await verifyConnection(
            request.coderUrl || settings.coderUrl,
            request.apiToken || settings.coderApiToken
          );
          sendResponse(result);
          break;
        }

        case 'CHECK_WORKSPACE': {
          if (!settings.coderUrl || !settings.coderApiToken) {
            sendResponse({
              status: 'unconfigured',
              error: 'Coder API not configured'
            });
            break;
          }

          const result = await checkWorkspace(
            settings.coderUrl,
            settings.coderApiToken,
            request.repo,
            request.branch
          );

          // Include launcher URL for fallback/create action
          if (result.status === 'missing' && settings.launcherUrl) {
            result.launcherUrl = settings.launcherUrl;
          }

          sendResponse(result);
          break;
        }

        case 'GET_TEMPLATES': {
          if (!settings.coderUrl || !settings.coderApiToken) {
            sendResponse({
              success: false,
              error: 'Coder API not configured'
            });
            break;
          }

          const result = await getTemplates(
            settings.coderUrl,
            settings.coderApiToken
          );
          sendResponse(result);
          break;
        }

        case 'GET_SETTINGS': {
          sendResponse({
            coderUrl: settings.coderUrl,
            hasApiToken: !!settings.coderApiToken,
            launcherUrl: settings.launcherUrl,
            gheUrl: settings.gheUrl
          });
          break;
        }

        case 'START_WORKSPACE': {
          if (!settings.coderUrl || !settings.coderApiToken) {
            sendResponse({
              success: false,
              error: 'Coder API not configured'
            });
            break;
          }

          const result = await startWorkspace(
            settings.coderUrl,
            settings.coderApiToken,
            request.workspaceId
          );
          sendResponse(result);
          break;
        }

        case 'STOP_WORKSPACE': {
          if (!settings.coderUrl || !settings.coderApiToken) {
            sendResponse({
              success: false,
              error: 'Coder API not configured'
            });
            break;
          }

          const result = await stopWorkspace(
            settings.coderUrl,
            settings.coderApiToken,
            request.workspaceId
          );
          sendResponse(result);
          break;
        }

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      sendResponse({ error: error.message });
    }
  })();

  // Return true to indicate async response
  return true;
});
