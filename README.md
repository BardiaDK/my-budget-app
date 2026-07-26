# My Budget V4 — Monthly Debt Contributions

This version adds a complete monthly debt contribution center without requiring any new Supabase tables.

## New features
- Monthly contribution page with year filter
- Credit Card and Line of Credit breakdown by month
- Monthly goal progress and status
- Contribution bar chart
- Yearly contribution total and monthly average
- Best contribution month
- Estimated debt payoff month based on average payments
- Monthly debt goal card on the dashboard

## Upgrade from V3
1. Keep your existing `config.js` containing your Supabase publishable key.
2. Replace `index.html`, `style.css`, `app.js`, `sw.js`, `manifest.json`, and `README.md` in GitHub with these files.
3. If you upload this ZIP as-is, edit `config.js` and paste your existing `sb_publishable_...` key.
4. Commit the files and wait about one minute for GitHub Pages to refresh.
5. On a phone, you may need to close and reopen the installed app once so the new service worker cache loads.

No SQL changes are required. V4 reads your existing `debt_payments` records and groups them by payment date.
