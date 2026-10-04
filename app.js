(() => {
  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_")) {
    alert("Your existing config.js is missing or does not contain the Supabase publishable key.");
    return;
  }

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"}).format(Number(value || 0));
  const escapeHtml = str => String(str ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  let authMode = "signin";
  let currentUser = null;
  let settings = null;
  let expenses = [];
  let payments = [];

  function toLocalIso(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  const isoToday = () => toLocalIso(new Date());

  function parseLocalDate(dateStr) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  function toast(text) {
    $("toast").textContent = text;
    $("toast").classList.add("show");
    setTimeout(() => $("toast").classList.remove("show"), 2600);
  }

  function localDate(dateStr, options = {month:"short", day:"numeric", year:"numeric"}) {
    return parseLocalDate(dateStr).toLocaleDateString("en-US", options);
  }

  function mondayOf(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    return toLocalIso(d);
  }

  function addDays(dateStr, days) {
    const d = parseLocalDate(dateStr);
    d.setDate(d.getDate() + days);
    return toLocalIso(d);
  }

  function addMonths(date, months) {
    const d = new Date(date.getFullYear(), date.getMonth() + months, 1, 12);
    return d;
  }

  function budgetCategories() {
    return {
      Groceries: Number(settings.groceries_budget || 0),
      Activity: Number(settings.activity_budget || 0),
      Gas: Number(settings.gas_budget || 0),
      Other: Number(settings.other_budget || 0)
    };
  }

  function weeklyBudgetTotal() {
    return Object.values(budgetCategories()).reduce((a, b) => a + b, 0);
  }

  function preferredWeekday() {
    return parseLocalDate(settings.week_start || mondayOf()).getDay();
  }

  function weekStartFor(date = new Date()) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    const target = preferredWeekday();
    const diff = (d.getDay() - target + 7) % 7;
    d.setDate(d.getDate() - diff);
    return toLocalIso(d);
  }

  function dateInRange(value, start, end) {
    return value >= start && value <= end;
  }

  function sumExpenses(start, end, category = null) {
    return expenses
      .filter(x => dateInRange(x.expense_date, start, end) && (!category || x.category === category))
      .reduce((a, x) => a + Number(x.amount), 0);
  }

  function currentMonthBounds(date = new Date()) {
    const start = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
    return { start: toLocalIso(start), end: toLocalIso(end) };
  }

  function monthlyBudgetForDate(date, toDate = false) {
    const weekly = weeklyBudgetTotal();
    const daily = weekly / 7;
    const days = toDate ? date.getDate() : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return daily * days;
  }

  function showApp(user) {
    currentUser = user;
    $("authView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("userEmail").textContent = user.email || "";
    loadAll();
  }

  function showAuth() {
    currentUser = null;
    $("appView").classList.add("hidden");
    $("authView").classList.remove("hidden");
  }

  function setAuthMode(mode) {
    authMode = mode;
    $("signInTab").classList.toggle("active", mode === "signin");
    $("signUpTab").classList.toggle("active", mode === "signup");
    $("authSubmit").textContent = mode === "signin" ? "Sign in" : "Create account";
    $("authPassword").autocomplete = mode === "signin" ? "current-password" : "new-password";
    $("authMessage").textContent = "";
  }

  async function ensureSettings() {
    const { data, error } = await db.from("budget_settings").select("*").eq("user_id", currentUser.id).maybeSingle();
    if (error) throw error;
    if (data) return data;
    const defaults = {
      user_id: currentUser.id,
      week_start: mondayOf(),
      groceries_budget: 100,
      activity_budget: 60,
      gas_budget: 70,
      other_budget: 20,
      starting_credit_card_balance: 0,
      starting_loc_balance: 0,
      monthly_debt_goal: 0
    };
    const { data: created, error: createError } = await db.from("budget_settings").insert(defaults).select().single();
    if (createError) throw createError;
    return created;
  }

  async function loadAll() {
    try {
      settings = await ensureSettings();
      const [expenseResult, debtResult] = await Promise.all([
        db.from("expenses").select("*").order("expense_date", {ascending:false}).order("created_at", {ascending:false}),
        db.from("debt_payments").select("*").order("payment_date", {ascending:false}).order("created_at", {ascending:false})
      ]);
      if (expenseResult.error) throw expenseResult.error;
      if (debtResult.error) throw debtResult.error;
      expenses = expenseResult.data || [];
      payments = debtResult.data || [];
      render();
    } catch (err) {
      console.error(err);
      toast(err.message || "Unable to load data");
    }
  }

  function render() {
    renderSettings();
    renderDashboard();
    renderExpenses();
    renderDebt();
    renderContributionYearOptions();
    renderContributions();
  }

  function renderSettings() {
    $("weekStart").value = settings.week_start;
    $("monthlyDebtGoal").value = settings.monthly_debt_goal;
    $("budgetGroceries").value = settings.groceries_budget;
    $("budgetActivity").value = settings.activity_budget;
    $("budgetGas").value = settings.gas_budget;
    $("budgetOther").value = settings.other_budget;
    $("startingCreditCard").value = settings.starting_credit_card_balance;
    $("startingLoc").value = settings.starting_loc_balance;
  }

  function currentMonthPaid() {
    const prefix = isoToday().slice(0, 7);
    return payments.filter(x => x.payment_date.startsWith(prefix)).reduce((a, x) => a + Number(x.amount), 0);
  }

  function remainingDebt() {
    const ccPaid = payments.filter(x => x.account === "Credit Card").reduce((a, x) => a + Number(x.amount), 0);
    const locPaid = payments.filter(x => x.account === "Line of Credit").reduce((a, x) => a + Number(x.amount), 0);
    return {
      cc: Math.max(0, Number(settings.starting_credit_card_balance) - ccPaid),
      loc: Math.max(0, Number(settings.starting_loc_balance) - locPaid)
    };
  }

  function weeklyTrendData() {
    const currentStart = weekStartFor(new Date());
    const rows = [];
    const budget = weeklyBudgetTotal();
    for (let i = 7; i >= 0; i--) {
      const start = addDays(currentStart, -7 * i);
      const end = addDays(start, 6);
      const spent = sumExpenses(start, end);
      rows.push({
        start,
        end,
        label: localDate(start, {month:"short", day:"numeric"}),
        spent,
        saved: Math.max(0, budget - spent),
        over: Math.max(0, spent - budget),
        budget
      });
    }
    return rows;
  }

  function monthlyTrendData() {
    const today = new Date();
    const rows = [];
    for (let i = 5; i >= 0; i--) {
      const d = addMonths(today, -i);
      const year = d.getFullYear();
      const month = d.getMonth();
      const start = toLocalIso(new Date(year, month, 1, 12));
      const end = toLocalIso(new Date(year, month + 1, 0, 12));
      const isCurrent = year === today.getFullYear() && month === today.getMonth();
      const effectiveEnd = isCurrent ? isoToday() : end;
      const spent = sumExpenses(start, effectiveEnd);
      const budget = monthlyBudgetForDate(d, isCurrent);
      rows.push({
        label: d.toLocaleDateString("en-US", {month:"short"}),
        spent,
        budget,
        saved: budget - spent,
        isCurrent
      });
    }
    return rows;
  }

  function renderWeeklyTrend() {
    const rows = weeklyTrendData();
    const maxValue = Math.max(weeklyBudgetTotal(), ...rows.flatMap(x => [x.spent, x.saved]), 1);
    $("weeklySpendingChart").innerHTML = rows.map((x, index) => {
      const spentHeight = Math.max(x.spent > 0 ? 5 : 0, (x.spent / maxValue) * 100);
      const savedHeight = Math.max(x.saved > 0 ? 5 : 0, (x.saved / maxValue) * 100);
      const current = index === rows.length - 1 ? " current-period" : "";
      const savedText = x.over > 0 ? `${money(x.over)} over` : `${money(x.saved)} saved`;
      return `<div class="trend-group${current}" title="${localDate(x.start)} – ${localDate(x.end)} · ${money(x.spent)} spent · ${savedText}">
        <div class="trend-values"><span>${x.spent ? money(x.spent) : ""}</span><span>${x.saved ? money(x.saved) : ""}</span></div>
        <div class="trend-bars"><div class="trend-bar spent" style="height:${spentHeight}%"></div><div class="trend-bar saved" style="height:${savedHeight}%"></div></div>
        <span class="trend-label">${x.label}</span>
      </div>`;
    }).join("");
  }

  function renderMonthlyTrend() {
    const rows = monthlyTrendData();
    const maxValue = Math.max(...rows.flatMap(x => [x.spent, x.budget]), 1);
    $("monthlySpendingChart").innerHTML = rows.map(x => {
      const spentHeight = Math.max(x.spent > 0 ? 5 : 0, (x.spent / maxValue) * 100);
      const budgetHeight = Math.max(x.budget > 0 ? 5 : 0, (x.budget / maxValue) * 100);
      return `<div class="trend-group${x.isCurrent ? " current-period" : ""}" title="${x.label}: ${money(x.spent)} spent · ${money(x.budget)} budget${x.isCurrent ? " to date" : ""}">
        <div class="trend-values"><span>${x.spent ? money(x.spent) : "$0"}</span><span>${money(x.budget)}</span></div>
        <div class="trend-bars"><div class="trend-bar spent" style="height:${spentHeight}%"></div><div class="trend-bar budget" style="height:${budgetHeight}%"></div></div>
        <span class="trend-label">${x.label}${x.isCurrent ? "*" : ""}</span>
      </div>`;
    }).join("");
  }

  function renderDashboard() {
    const today = new Date();
    const start = weekStartFor(today);
    const end = addDays(start, 6);
    const categories = budgetCategories();
    const totalBudget = weeklyBudgetTotal();
    const totalSpent = sumExpenses(start, end);
    const weeklyBalance = totalBudget - totalSpent;
    const monthBounds = currentMonthBounds(today);
    const monthSpent = sumExpenses(monthBounds.start, isoToday());
    const monthBudgetToDate = monthlyBudgetForDate(today, true);
    const monthBalance = monthBudgetToDate - monthSpent;
    const debtThisMonth = currentMonthPaid();
    const debtGoal = Number(settings.monthly_debt_goal || 0);
    const goalPctRaw = debtGoal > 0 ? (debtThisMonth / debtGoal) * 100 : 0;

    $("weekLabel").textContent = `${localDate(start)} – ${localDate(end)}`;
    $("weeklyBudgetKpi").textContent = money(totalBudget);
    $("weeklySpentKpi").textContent = money(totalSpent);
    $("weeklyRemainingKpi").textContent = money(Math.abs(weeklyBalance));
    $("weeklySavedLabel").textContent = weeklyBalance >= 0 ? "Saved / available" : "Over budget";
    $("weeklyRemainingKpi").classList.toggle("negative-text", weeklyBalance < 0);
    $("weeklyRemainingKpi").classList.toggle("positive-text", weeklyBalance >= 0);
    $("monthlySpentKpi").textContent = money(monthSpent);

    $("monthNameLabel").textContent = today.toLocaleDateString("en-US", {month:"long", year:"numeric"});
    $("weekSnapshotSaved").textContent = weeklyBalance >= 0 ? `${money(weeklyBalance)} saved / available` : `${money(Math.abs(weeklyBalance))} over budget`;
    $("weekSnapshotSaved").classList.toggle("negative-text", weeklyBalance < 0);
    $("weekSnapshotDetail").textContent = `${money(totalSpent)} spent of ${money(totalBudget)}`;
    $("monthSnapshotSaved").textContent = monthBalance >= 0 ? `${money(monthBalance)} saved / available` : `${money(Math.abs(monthBalance))} over budget`;
    $("monthSnapshotSaved").classList.toggle("negative-text", monthBalance < 0);
    $("monthSnapshotDetail").textContent = `${money(monthSpent)} spent of ${money(monthBudgetToDate)} budget to date`;

    const categoryRows = Object.entries(categories).map(([name, budget]) => ({name, budget, spent: sumExpenses(start, end, name)}));
    const untouched = categoryRows.filter(x => x.spent === 0 && x.budget > 0).map(x => x.name);
    const largest = categoryRows.reduce((a, b) => b.spent > a.spent ? b : a, {name:"", spent:0});
    let insight = weeklyBalance >= 0
      ? `You are ${money(weeklyBalance)} under your weekly budget right now.`
      : `You are ${money(Math.abs(weeklyBalance))} over your weekly budget right now.`;
    if (untouched.length) insight += ` No spending yet in ${untouched.join(" and ")}.`;
    else if (largest.spent > 0) insight += ` Your largest category this week is ${largest.name} at ${money(largest.spent)}.`;
    if (monthBalance >= 0) insight += ` Month-to-date, ${money(monthBalance)} of your budget is still unspent.`;
    else insight += ` Month-to-date, spending is ${money(Math.abs(monthBalance))} above your budget pace.`;
    $("dashboardInsight").textContent = insight;

    $("dashboardDebtGoalAmount").textContent = `${money(debtThisMonth)} of ${money(debtGoal)}`;
    $("dashboardDebtGoalPercent").textContent = debtGoal > 0 ? `${Math.round(goalPctRaw)}%` : "0%";
    $("dashboardDebtGoalFill").style.width = `${Math.min(goalPctRaw, 100)}%`;
    $("dashboardDebtGoalFill").classList.toggle("complete", goalPctRaw >= 100);
    $("dashboardDebtGoalMessage").textContent = debtGoal <= 0
      ? "Set a monthly debt goal in Settings."
      : goalPctRaw >= 100
        ? `Goal reached — you are ${money(debtThisMonth - debtGoal)} ahead this month.`
        : `${money(debtGoal - debtThisMonth)} remaining to reach this month’s goal.`;

    $("categoryProgress").innerHTML = categoryRows.map(({name, budget, spent}) => {
      const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : (spent > 0 ? 100 : 0);
      const available = budget - spent;
      const detail = available >= 0 ? `${money(available)} left` : `${money(Math.abs(available))} over`;
      return `<div class="progress"><div class="progress-meta"><strong>${name}</strong><span>${money(spent)} / ${money(budget)} · ${detail}</span></div><div class="track"><div class="fill ${spent > budget ? 'over' : ''}" style="width:${pct}%"></div></div></div>`;
    }).join("");

    $("recentExpenses").innerHTML = expenseItems(expenses.slice(0, 5), false);
    renderWeeklyTrend();
    renderMonthlyTrend();
  }

  function expenseItems(rows, showDelete = true) {
    if (!rows.length) return `<div class="empty">No expenses yet.</div>`;
    return rows.map(x => `<div class="item"><div><div class="item-title">${escapeHtml(x.description || x.category)}</div><div class="item-sub">${escapeHtml(x.category)} · ${localDate(x.expense_date)}</div></div><div class="amount">${money(x.amount)}</div>${showDelete ? `<button class="delete" data-delete-expense="${x.id}" type="button">Delete</button>` : `<span></span>`}</div>`).join("");
  }

  function renderExpenses() {
    $("expenseList").innerHTML = expenseItems(expenses, true);
  }

  function renderDebt() {
    const remain = remainingDebt();
    const monthPaid = currentMonthPaid();
    $("creditCardRemaining").textContent = money(remain.cc);
    $("locRemaining").textContent = money(remain.loc);
    $("totalDebtRemaining").textContent = money(remain.cc + remain.loc);
    $("monthlyDebtPaid").textContent = money(monthPaid);
    $("debtList").innerHTML = payments.length ? payments.map(x => `<div class="item"><div><div class="item-title">${escapeHtml(x.description || x.account)}</div><div class="item-sub">${escapeHtml(x.account)} · ${localDate(x.payment_date)}</div></div><div class="amount">${money(x.amount)}</div><button class="delete" data-delete-debt="${x.id}" type="button">Delete</button></div>`).join("") : `<div class="empty">No debt payments yet.</div>`;
  }

  function contributionData(year) {
    return monthNames.map((name, monthIndex) => {
      const prefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
      const rows = payments.filter(x => x.payment_date.startsWith(prefix));
      const cc = rows.filter(x => x.account === "Credit Card").reduce((a, x) => a + Number(x.amount), 0);
      const loc = rows.filter(x => x.account === "Line of Credit").reduce((a, x) => a + Number(x.amount), 0);
      return { name, short: name.slice(0, 3), cc, loc, total: cc + loc };
    });
  }

  function renderContributionYearOptions() {
    const currentYear = new Date().getFullYear();
    const years = new Set([currentYear, ...payments.map(x => Number(x.payment_date.slice(0, 4)))]);
    const previous = Number($("contributionYear").value || currentYear);
    $("contributionYear").innerHTML = [...years].sort((a, b) => b - a).map(y => `<option value="${y}">${y}</option>`).join("");
    $("contributionYear").value = years.has(previous) ? previous : currentYear;
  }

  function renderContributions() {
    const year = Number($("contributionYear").value || new Date().getFullYear());
    const rows = contributionData(year);
    const goal = Number(settings.monthly_debt_goal || 0);
    const total = rows.reduce((a, x) => a + x.total, 0);
    const activeRows = rows.filter(x => x.total > 0);
    const average = activeRows.length ? total / activeRows.length : 0;
    const best = rows.reduce((max, x) => x.total > max.total ? x : max, {name:"—", total:0});
    const remain = remainingDebt();
    const totalRemaining = remain.cc + remain.loc;
    const forecastBase = average > 0 ? average : goal;
    const monthsToPayoff = forecastBase > 0 ? Math.ceil(totalRemaining / forecastBase) : 0;
    const forecastDate = new Date();
    forecastDate.setMonth(forecastDate.getMonth() + monthsToPayoff);

    $("yearDebtTotal").textContent = money(total);
    $("monthlyDebtAverage").textContent = money(average);
    $("bestDebtMonth").textContent = best.total > 0 ? `${best.short} · ${money(best.total)}` : "—";
    $("payoffForecast").textContent = totalRemaining <= 0 ? "Debt-free" : monthsToPayoff > 0 ? forecastDate.toLocaleDateString("en-US", {month:"short", year:"numeric"}) : "Set a goal";
    $("contributionGoalLabel").textContent = goal > 0 ? `Monthly goal: ${money(goal)}` : "Set a goal in Settings";

    const maxValue = Math.max(goal, ...rows.map(x => x.total), 1);
    $("contributionChart").innerHTML = rows.map(x => {
      const height = Math.max(x.total > 0 ? 5 : 0, (x.total / maxValue) * 100);
      return `<div class="bar-column" title="${x.name}: ${money(x.total)}"><div class="bar-value">${x.total ? money(x.total) : ""}</div><div class="bar-space"><div class="bar" style="height:${height}%"></div></div><span>${x.short}</span></div>`;
    }).join("");

    $("contributionTableBody").innerHTML = rows.map(x => {
      const pct = goal > 0 ? (x.total / goal) * 100 : 0;
      const statusClass = pct >= 100 ? "goal-met" : pct >= 75 ? "goal-close" : "goal-low";
      return `<tr><td><strong>${x.name}</strong></td><td>${money(x.cc)}</td><td>${money(x.loc)}</td><td><strong>${money(x.total)}</strong></td><td>${money(goal)}</td><td><div class="table-progress"><div class="track"><div class="fill ${pct >= 100 ? 'complete' : ''}" style="width:${Math.min(pct, 100)}%"></div></div><span class="status ${statusClass}">${goal > 0 ? Math.round(pct) + '%' : '—'}</span></div></td></tr>`;
    }).join("");
  }

  function switchView(view) {
    ["dashboard", "expenses", "debt", "contributions", "settings"].forEach(name => $(`${name}View`).classList.toggle("hidden", name !== view));
    document.querySelectorAll(".nav").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
    window.scrollTo({top:0, behavior:"smooth"});
  }

  async function addExpenseFromForm({date, category, description, amount}) {
    const row = {
      user_id: currentUser.id,
      expense_date: date,
      category,
      description: description.trim() || category,
      amount: Number(amount)
    };
    const { error } = await db.from("expenses").insert(row);
    if (error) throw error;
  }

  $("signInTab").onclick = () => setAuthMode("signin");
  $("signUpTab").onclick = () => setAuthMode("signup");

  $("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    $("authSubmit").disabled = true;
    try {
      if (authMode === "signup") {
        const { data, error } = await db.auth.signUp({email, password, options:{emailRedirectTo:window.location.origin + window.location.pathname}});
        if (error) throw error;
        $("authMessage").textContent = data.session ? "Account created and signed in." : "Account created. Check your email to confirm it, then sign in.";
      } else {
        const { error } = await db.auth.signInWithPassword({email, password});
        if (error) throw error;
      }
    } catch (err) {
      $("authMessage").textContent = err.message || "Authentication failed.";
    } finally {
      $("authSubmit").disabled = false;
    }
  });

  $("forgotPassword").onclick = async () => {
    const email = $("authEmail").value.trim();
    if (!email) return toast("Enter your email address first.");
    const { error } = await db.auth.resetPasswordForEmail(email, {redirectTo:window.location.origin + window.location.pathname});
    toast(error ? error.message : "Password reset email sent.");
  };

  $("signOutButton").onclick = async () => { await db.auth.signOut(); showAuth(); };
  $("refreshButton").onclick = loadAll;
  $("contributionYear").onchange = renderContributions;
  document.querySelectorAll(".nav").forEach(btn => btn.onclick = () => switchView(btn.dataset.view));
  document.querySelectorAll(".jump").forEach(btn => btn.onclick = () => switchView(btn.dataset.target));

  $("quickExpenseForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await addExpenseFromForm({
        date: $("quickExpenseDate").value,
        category: $("quickExpenseCategory").value,
        description: $("quickExpenseDescription").value,
        amount: $("quickExpenseAmount").value
      });
      $("quickExpenseAmount").value = "";
      $("quickExpenseDescription").value = "";
      $("quickExpenseDate").value = isoToday();
      toast("Expense added.");
      await loadAll();
    } catch (err) {
      toast(err.message || "Unable to add expense.");
    }
  });

  $("expenseForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await addExpenseFromForm({
        date: $("expenseDate").value,
        category: $("expenseCategory").value,
        description: $("expenseDescription").value,
        amount: $("expenseAmount").value
      });
      e.target.reset();
      $("expenseDate").value = isoToday();
      toast("Expense added.");
      await loadAll();
    } catch (err) {
      toast(err.message || "Unable to add expense.");
    }
  });

  $("debtForm").addEventListener("submit", async e => {
    e.preventDefault();
    const row = {user_id:currentUser.id, payment_date:$("debtDate").value, account:$("debtAccount").value, description:$("debtDescription").value.trim(), amount:Number($("debtAmount").value)};
    const { error } = await db.from("debt_payments").insert(row);
    if (error) return toast(error.message);
    e.target.reset();
    $("debtDate").value = isoToday();
    toast("Debt payment added.");
    await loadAll();
  });

  $("settingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    const row = {
      user_id: currentUser.id,
      week_start: $("weekStart").value,
      monthly_debt_goal: Number($("monthlyDebtGoal").value || 0),
      groceries_budget: Number($("budgetGroceries").value),
      activity_budget: Number($("budgetActivity").value),
      gas_budget: Number($("budgetGas").value),
      other_budget: Number($("budgetOther").value),
      starting_credit_card_balance: Number($("startingCreditCard").value),
      starting_loc_balance: Number($("startingLoc").value),
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from("budget_settings").upsert(row, {onConflict:"user_id"});
    if (error) return toast(error.message);
    toast("Settings saved.");
    await loadAll();
  });

  document.addEventListener("click", async e => {
    const expenseId = e.target.dataset.deleteExpense;
    const debtId = e.target.dataset.deleteDebt;
    if (expenseId && confirm("Delete this expense?")) {
      const { error } = await db.from("expenses").delete().eq("id", expenseId);
      if (error) return toast(error.message);
      toast("Expense deleted.");
      await loadAll();
    }
    if (debtId && confirm("Delete this debt payment?")) {
      const { error } = await db.from("debt_payments").delete().eq("id", debtId);
      if (error) return toast(error.message);
      toast("Payment deleted.");
      await loadAll();
    }
  });

  $("exportCsv").onclick = () => {
    const rows = [["Date","Category","Description","Amount"], ...expenses.map(x => [x.expense_date, x.category, x.description, Number(x.amount).toFixed(2)])];
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${isoToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  $("expenseDate").value = isoToday();
  $("debtDate").value = isoToday();
  $("quickExpenseDate").value = isoToday();

  db.auth.onAuthStateChange((_event, session) => session?.user ? showApp(session.user) : showAuth());
  db.auth.getSession().then(({data}) => data.session?.user ? showApp(data.session.user) : showAuth());

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js?v=5").catch(console.error));
  }
})();
