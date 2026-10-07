# RBX Market

A Roblox marketplace storefront with an admin panel. Offers and their pictures are stored in Vercel Blob, so every visitor sees the same offers.

## Deploy

1. Push this folder to a new GitHub repository.
2. On vercel.com, click **Add New → Project**, import the repository, and click **Deploy**.
3. In the Vercel project, go to **Storage → Create → Blob** and connect it to the project. This adds `BLOB_READ_WRITE_TOKEN` automatically.
4. Go to **Settings → Environment Variables** and add:
   - `ADMIN_PASSWORD`: the admin password (currently `1234`; change it before going live)
   - `SESSION_SECRET`: a long random string, for example the output of `openssl rand -hex 32`
5. Go to **Deployments** and redeploy so the variables take effect.

## Use

- Click **Admin** in the top right and log in.
- Add offers with a picture, description, and price. They appear on the storefront immediately.
- Delete offers from the list in the admin panel.

## Notes

- Pictures are resized in the browser before upload to keep them small.
- Two admins saving at the exact same moment can overwrite each other's changes. This won't happen with a single admin.
