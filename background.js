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
      // Workspace exists - return URL to open it
      const workspaceUrl = `${coderUrl}/@${workspace.owner_name}/${workspace.name}`;
      return {
        status: 'found',
        workspaceName: workspace.name,
        workspaceUrl: workspaceUrl,
        ownerName: workspace.owner_name,
        templateName: workspace.template_name,
        latestBuild: workspace.latest_build?.status
      };
    } else {
      // Workspace doesn't exist - return URL to create it
      // The create URL will need to be filled in by the user or use a template
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
