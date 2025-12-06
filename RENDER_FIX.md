# Render Deployment Fix

## Error: Root Directory "/opt/render/project/src/server" is missing

This error occurs when Render is configured to look for the server in a subdirectory, but your GitHub repository root IS the server directory.

## Solution:

### Step 1: Check Your Render Service Settings

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click on your web service (eduhive-server)
3. Go to **Settings** tab
4. Scroll down to **Root Directory**

### Step 2: Fix Root Directory

**Current (Wrong) Configuration:**
- Root Directory: `/src/server` or `/server`

**Correct Configuration:**
- Root Directory: `/` (root) or **leave it EMPTY**

### Step 3: Save and Redeploy

1. Click **Save Changes**
2. Go to **Manual Deploy** → **Deploy latest commit**
3. Wait for deployment to complete

## Why This Happens:

- If your GitHub repo structure is:
  ```
  your-repo/
  ├── package.json  ← Server root
  ├── src/
  └── ...
  ```
  Then Root Directory should be `/` (root)

- If your GitHub repo structure was:
  ```
  your-repo/
  ├── server/
  │   ├── package.json
  │   └── src/
  └── ...
  ```
  Then Root Directory would be `/server`

Since you've pushed the server directory as the root of your GitHub repo, use `/` (root).

## Alternative: Using render.yaml

If you have a `render.yaml` file in your repo root, Render will use those settings. The file is already created in your repo.

Make sure in Render dashboard:
- **Root Directory**: `/` or empty
- **Build Command**: `npm install`
- **Start Command**: `npm start`

