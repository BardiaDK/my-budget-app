# Budget App V3 — Supabase Cloud Sync

## 1. Add your publishable key

Open `config.js`.

Replace:

```js
PASTE_YOUR_SB_PUBLISHABLE_KEY_HERE
```

with the default key beginning with:

```text
sb_publishable_
```

Do not use the secret key.

## 2. Upload to GitHub

Replace the files in your existing `my-budget-app` repository with all files from this folder:

- index.html
- style.css
- app.js
- config.js
- manifest.json
- sw.js

Commit the changes. GitHub Pages will redeploy automatically.

## 3. Supabase URL configuration

In Supabase Authentication > URL Configuration, use:

Site URL:
`https://bardiadk.github.io/my-budget-app/`

Redirect URL:
`https://bardiadk.github.io/my-budget-app/**`

## 4. Test

1. Open the GitHub Pages app.
2. Create an account.
3. Confirm the email if Supabase requires confirmation.
4. Sign in.
5. Save budget settings.
6. Add one expense.
7. Open the same app on another device and sign in with the same account.

## Notes

- Financial records are stored in Supabase.
- Row Level Security policies restrict records to the signed-in user.
- The publishable key may appear in frontend code. The secret key must never be uploaded to GitHub.
