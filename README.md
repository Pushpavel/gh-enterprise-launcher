# GitHub Enterprise Devcontainer Launcher

A Chrome extension that adds a "Launch Devcontainer" button to GitHub Enterprise Server 3.14 repositories.

## Features

- **Manifest V3** compliant
- Works with any GitHub Enterprise Server instance (user-configured)
- Customizable launcher URL with placeholder support
- Matches GitHub's native button styling
- Supports dark mode
- Handles SPA navigation

## Installation

1. **Create icon files** (required for Chrome):
   ```
   icons/
   ├── icon16.png   (16x16 pixels)
   ├── icon48.png   (48x48 pixels)
   └── icon128.png  (128x128 pixels)
   ```
   
   You can use any icon, or create simple ones with the devcontainer/container logo.

2. **Load in Chrome**:
   - Go to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select this `gh-enterprise-launcher` directory

3. **Configure the extension**:
   - Click the extension icon → "Options" (or right-click → "Options")
   - Enter your GitHub Enterprise Base URL (e.g., `https://github.internal.com`)
   - Enter your Launcher Template URL with placeholders

## Configuration

### GitHub Enterprise Base URL
The root URL of your GitHub Enterprise instance, without a trailing slash.

Example: `https://github.internal.com`

### Launcher Template URL
The URL template for your devcontainer launcher service. Supports these placeholders:

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{ssh_url}` | SSH clone URL (URL-encoded) | `git%40github.internal.com%3Auser%2Frepo.git` |
| `{branch}` | Current branch/ref name (URL-encoded) | `main`, `feature%2Fmy-branch` |

Example template:
```
https://launcher.company.com/start?repo={ssh_url}&ref={branch}
```

## How It Works

1. The content script runs on all pages but immediately exits if the page origin doesn't match your configured GHE URL
2. On matching repository pages, it:
   - Extracts the owner/repo from the URL path
   - Detects the current branch from the branch selector
   - Constructs the SSH URL using the pattern `git@<host>:<owner>/<repo>.git`
3. Injects a "Launch Devcontainer" button near the "Code" button
4. Clicking the button opens your launcher URL with placeholders replaced

## File Structure

```
gh-enterprise-launcher/
├── manifest.json    # Extension manifest (MV3)
├── content.js       # Content script (button injection)
├── styles.css       # Button styling
├── options.html     # Settings page
├── options.js       # Settings logic
├── icons/           # Extension icons (you create these)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md        # This file
```

## Troubleshooting

**Button doesn't appear?**
- Make sure you've configured the GHE Base URL in extension options
- Verify you're on a repository page (not the homepage or settings)
- Check the browser console for errors

**Wrong branch detected?**
- The extension tries multiple selectors for branch detection
- Falls back to URL path (`/tree/<branch>/...`) or defaults to `main`

**Button styling looks off?**
- GHE versions may have slightly different CSS classes
- The extension uses `!important` rules to ensure consistency

## License

MIT
