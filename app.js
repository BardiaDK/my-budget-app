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
  let closeouts = [];
  let closeoutsAvailable = true;
  let selectedWeekStart = null;
  let selectedMonthDate = null;

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

  function firstOfMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 12);
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function monthSummary(date) {
    const monthDate = firstOfMonth(date);
    const today = new Date();
    const isCurrent = sameMonth(monthDate, today);
    const bounds = currentMonthBounds(monthDate);
    const effectiveEnd = isCurrent ? isoToday() : bounds.end;
    const spent = sumExpenses(bounds.start, effectiveEnd);

    // Monthly reporting uses the FULL calendar-month budget so an early
    // purchase (for example a tank of gas on the 3rd) is not labelled
    // "over budget" just because only a few days of the month have passed.
    const fullBudget = monthlyBudgetForDate(monthDate, false);
    const paceBudget = isCurrent ? monthlyBudgetForDate(today, true) : fullBudget;

    return {
      monthDate,
      isCurrent,
      start: bounds.start,
      end: bounds.end,
      effectiveEnd,
      spent,
      budget: fullBudget,
      fullBudget,
      paceBudget,
      balance: fullBudget - spent,
      paceDifference: paceBudget - spent
    };
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

  function closeoutForWeek(weekStart) {
    return closeouts.find(x => x.week_start === weekStart) || null;
  }

  function carryInForWeek(weekStart) {
    const previous = closeoutForWeek(addDays(weekStart, -7));
    return previous && previous.allocation_type === "Carry Forward" ? Number(previous.allocation_amount || 0) : 0;
  }

  function weeklyBudgetForStart(weekStart) {
    return weeklyBudgetTotal() + carryInForWeek(weekStart);
  }

  function closeoutTotals() {
    return closeouts.reduce((acc, x) => {
      const amount = Number(x.allocation_amount || 0);
      if (x.allocation_type === "Savings") acc.savings += amount;
      if (x.allocation_type === "Debt") acc.debt += amount;
      return acc;
    }, {savings:0, debt:0});
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
      if (!selectedWeekStart) selectedWeekStart = weekStartFor(new Date());
      if (!selectedMonthDate) selectedMonthDate = firstOfMonth(new Date());
      const [expenseResult, debtResult, closeoutResult] = await Promise.all([
        db.from("expenses").select("*").order("expense_date", {ascending:false}).order("created_at", {ascending:false}),
        db.from("debt_payments").select("*").order("payment_date", {ascending:false}).order("created_at", {ascending:false}),
        db.from("weekly_closeouts").select("*").order("week_start", {ascending:false})
      ]);
      if (expenseResult.error) throw expenseResult.error;
      if (debtResult.error) throw debtResult.error;
      expenses = expenseResult.data || [];
      payments = debtResult.data || [];
      if (closeoutResult.error) {
        const msg = `${closeoutResult.error.code || ""} ${closeoutResult.error.message || ""}`.toLowerCase();
        if (msg.includes("weekly_closeouts") || msg.includes("pgrst205") || msg.includes("42p01")) {
          closeoutsAvailable = false;
          closeouts = [];
        } else {
          throw closeoutResult.error;
        }
      } else {
        closeoutsAvailable = true;
        closeouts = closeoutResult.data || [];
      }
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
    const anchor = selectedWeekStart || weekStartFor(new Date());
    const currentStart = weekStartFor(new Date());
    const rows = [];
    for (let i = 7; i >= 0; i--) {
      const start = addDays(anchor, -7 * i);
      const end = addDays(start, 6);
      const budget = weeklyBudgetForStart(start);
      const spent = sumExpenses(start, end);
      rows.push({
        start,
        end,
        label: localDate(start, {month:"short", day:"numeric"}),
        spent,
        saved: Math.max(0, budget - spent),
        over: Math.max(0, spent - budget),
        budget,
        isCurrent: start === currentStart,
        isSelected: start === anchor
      });
    }
    return rows;
  }

  function monthlyTrendData() {
    const anchor = selectedMonthDate || firstOfMonth(new Date());
    const rows = [];
    for (let i = 5; i >= 0; i--) {
      const d = addMonths(anchor, -i);
      const summary = monthSummary(d);
      rows.push({
        monthStart: toLocalIso(firstOfMonth(d)),
        label: d.toLocaleDateString("en-US", {month:"short"}),
        longLabel: d.toLocaleDateString("en-US", {month:"long", year:"numeric"}),
        spent: summary.spent,
        budget: summary.budget,
        saved: summary.balance,
        isCurrent: summary.isCurrent,
        isSelected: sameMonth(d, anchor)
      });
    }
    return rows;
  }

  function renderWeeklyTrend() {
    const rows = weeklyTrendData();
    const maxValue = Math.max(...rows.flatMap(x => [x.spent, x.saved, x.over, x.budget]), 1);
    $("weeklySpendingChart").innerHTML = rows.map(x => {
      const spentHeight = Math.max(x.spent > 0 ? 5 : 0, (x.spent / maxValue) * 100);
      const savedHeight = Math.max(x.saved > 0 ? 5 : 0, (x.saved / maxValue) * 100);
      const savedText = x.over > 0 ? `${money(x.over)} over` : `${money(x.saved)} saved`;
      const classes = ["trend-group", x.isCurrent ? "current-period" : "", x.isSelected ? "selected-period" : ""].filter(Boolean).join(" ");
      return `<button class="${classes}" data-week-start="${x.start}" type="button" title="${localDate(x.start)} – ${localDate(x.end)} · ${money(x.spent)} spent · ${savedText}" aria-label="Select week ${localDate(x.start)} to ${localDate(x.end)}">
        <div class="trend-values"><span>${x.spent ? money(x.spent) : ""}</span><span>${x.saved ? money(x.saved) : ""}</span></div>
        <div class="trend-bars"><div class="trend-bar spent" style="height:${spentHeight}%"></div><div class="trend-bar saved" style="height:${savedHeight}%"></div></div>
        <span class="trend-label">${x.label}</span>
      </button>`;
    }).join("");
    if (rows.length) {
      $("weeklyChartSubtitle").textContent = `${localDate(rows[0].start, {month:"short", day:"numeric", year:"numeric"})} – ${localDate(rows[rows.length - 1].end, {month:"short", day:"numeric", year:"numeric"})} · tap a week`;
    }
  }

  function renderMonthlyTrend() {
    const rows = monthlyTrendData();
    const maxValue = Math.max(...rows.flatMap(x => [x.spent, x.budget]), 1);
    $("monthlySpendingChart").innerHTML = rows.map(x => {
      const spentHeight = Math.max(x.spent > 0 ? 5 : 0, (x.spent / maxValue) * 100);
      const budgetHeight = Math.max(x.budget > 0 ? 5 : 0, (x.budget / maxValue) * 100);
      const classes = ["trend-group", x.isCurrent ? "current-period" : "", x.isSelected ? "selected-period" : ""].filter(Boolean).join(" ");
      return `<button class="${classes}" data-month-start="${x.monthStart}" type="button" title="${x.longLabel}: ${money(x.spent)} ${x.isCurrent ? "spent so far" : "spent"} · ${money(x.budget)} full-month budget" aria-label="Select ${x.longLabel}">
        <div class="trend-values"><span>${x.spent ? money(x.spent) : "$0"}</span><span>${money(x.budget)}</span></div>
        <div class="trend-bars"><div class="trend-bar spent" style="height:${spentHeight}%"></div><div class="trend-bar budget" style="height:${budgetHeight}%"></div></div>
        <span class="trend-label">${x.label}${x.isCurrent ? "*" : ""}</span>
      </button>`;
    }).join("");
    if (rows.length) {
      $("monthlyChartSubtitle").textContent = `6 months ending ${rows[rows.length - 1].longLabel} · tap a month`;
    }
  }

  function renderDashboard() {
    const today = new Date();
    const currentWeekStart = weekStartFor(today);
    if (!selectedWeekStart || selectedWeekStart > currentWeekStart) selectedWeekStart = currentWeekStart;
    if (!selectedMonthDate || monthKey(selectedMonthDate) > monthKey(today)) selectedMonthDate = firstOfMonth(today);

    const start = selectedWeekStart;
    const end = addDays(start, 6);
    const isCurrentWeek = start === currentWeekStart;
    const monthInfo = monthSummary(selectedMonthDate);
    const isCurrentMonth = monthInfo.isCurrent;
    const categories = budgetCategories();
    const baseBudget = weeklyBudgetTotal();
    const carryIn = carryInForWeek(start);
    const totalBudget = weeklyBudgetForStart(start);
    const totalSpent = sumExpenses(start, end);
    const weeklyBalance = totalBudget - totalSpent;
    const monthSpent = monthInfo.spent;
    const monthBudget = monthInfo.fullBudget;
    const monthPaceBudget = monthInfo.paceBudget;
    const monthBalance = monthInfo.balance;
    const monthPaceDifference = monthInfo.paceDifference;

    const debtThisMonth = currentMonthPaid();
    const debtGoal = Number(settings.monthly_debt_goal || 0);
    const goalPctRaw = debtGoal > 0 ? (debtThisMonth / debtGoal) * 100 : 0;

    $("weekLabel").textContent = `${localDate(start)} – ${localDate(end)}`;
    $("weeklyBudgetKpi").textContent = money(totalBudget);
    $("weeklyBudgetKpi").title = carryIn > 0 ? `${money(baseBudget)} base + ${money(carryIn)} carried in` : `${money(baseBudget)} base budget`;
    $("weeklySpentLabel").textContent = isCurrentWeek ? "Spent this week" : "Spent selected week";
    $("weeklySpentKpi").textContent = money(totalSpent);
    $("weeklyRemainingKpi").textContent = money(Math.abs(weeklyBalance));
    $("weeklySavedLabel").textContent = weeklyBalance >= 0 ? (isCurrentWeek ? "Saved / available" : "Saved that week") : "Over budget";
    $("weeklyRemainingKpi").classList.toggle("negative-text", weeklyBalance < 0);
    $("weeklyRemainingKpi").classList.toggle("positive-text", weeklyBalance >= 0);
    $("monthlySpentLabel").textContent = isCurrentMonth ? "Spent this month" : "Spent selected month";
    $("monthlySpentKpi").textContent = money(monthSpent);

    $("prevWeekButton").disabled = false;
    $("nextWeekButton").disabled = isCurrentWeek;
    $("thisWeekButton").disabled = isCurrentWeek;
    $("prevMonthButton").disabled = false;
    $("nextMonthButton").disabled = isCurrentMonth;
    $("thisMonthButton").disabled = isCurrentMonth;

    $("monthNameLabel").textContent = selectedMonthDate.toLocaleDateString("en-US", {month:"long", year:"numeric"});
    $("weekSnapshotTitle").textContent = isCurrentWeek ? "This week" : "Selected week";
    $("weekSnapshotSaved").textContent = weeklyBalance >= 0 ? `${money(weeklyBalance)} saved / available` : `${money(Math.abs(weeklyBalance))} over budget`;
    $("weekSnapshotSaved").classList.toggle("negative-text", weeklyBalance < 0);
    $("weekSnapshotSaved").classList.toggle("positive-text", weeklyBalance >= 0);
    $("weekSnapshotDetail").textContent = `${money(totalSpent)} spent of ${money(totalBudget)}`;

    $("monthSnapshotTitle").textContent = isCurrentMonth ? "This month" : "Selected month";
    if (isCurrentMonth) {
      $("monthSnapshotSaved").textContent = monthBalance >= 0
        ? `${money(monthBalance)} remaining in full-month budget`
        : `${money(Math.abs(monthBalance))} over full-month budget`;
    } else {
      $("monthSnapshotSaved").textContent = monthBalance >= 0
        ? `${money(monthBalance)} saved / unused`
        : `${money(Math.abs(monthBalance))} over budget`;
    }
    $("monthSnapshotSaved").classList.toggle("negative-text", monthBalance < 0);
    $("monthSnapshotSaved").classList.toggle("positive-text", monthBalance >= 0);
    const paceText = isCurrentMonth
      ? ` · ${money(monthPaceBudget)} budget pace through today`
      : "";
    $("monthSnapshotDetail").textContent = `${money(monthSpent)} spent of ${money(monthBudget)} full-month budget${paceText}`;

    const categoryRows = Object.entries(categories).map(([name, budget]) => ({name, budget, spent: sumExpenses(start, end, name)}));
    const untouched = categoryRows.filter(x => x.spent === 0 && x.budget > 0).map(x => x.name);
    const largest = categoryRows.reduce((a, b) => b.spent > a.spent ? b : a, {name:"", spent:0});
    let insight = weeklyBalance >= 0
      ? `${isCurrentWeek ? "You are" : "You were"} ${money(weeklyBalance)} under budget ${isCurrentWeek ? "this week so far" : "for the selected week"}.`
      : `${isCurrentWeek ? "You are" : "You were"} ${money(Math.abs(weeklyBalance))} over budget ${isCurrentWeek ? "this week" : "for the selected week"}.`;
    if (untouched.length) insight += ` No spending ${isCurrentWeek ? "yet" : "was recorded"} in ${untouched.join(" and ")}.`;
    else if (largest.spent > 0) insight += ` The largest category ${isCurrentWeek ? "is" : "was"} ${largest.name} at ${money(largest.spent)}.`;
    if (isCurrentMonth) {
      if (monthBalance >= 0) insight += ` ${money(monthBalance)} remains in the full ${selectedMonthDate.toLocaleDateString("en-US", {month:"long"})} budget.`;
      else insight += ` ${selectedMonthDate.toLocaleDateString("en-US", {month:"long"})} spending is ${money(Math.abs(monthBalance))} above the full-month budget.`;

      if (monthPaceDifference >= 0) {
        insight += ` Spending is ${money(monthPaceDifference)} below today's budget pace.`;
      } else {
        insight += ` Spending is ${money(Math.abs(monthPaceDifference))} above today's pace, but that is not counted as over budget unless the full-month limit is exceeded.`;
      }
    } else {
      if (monthBalance >= 0) insight += ` ${selectedMonthDate.toLocaleDateString("en-US", {month:"long"})} finished with ${money(monthBalance)} unused.`;
      else insight += ` ${selectedMonthDate.toLocaleDateString("en-US", {month:"long"})} finished ${money(Math.abs(monthBalance))} over budget.`;
    }
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

    $("weeklyCategoryTitle").textContent = isCurrentWeek ? "Weekly category progress" : `Category progress · ${localDate(start, {month:"short", day:"numeric"})} week`;
    $("categoryProgress").innerHTML = categoryRows.map(({name, budget, spent}) => {
      const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : (spent > 0 ? 100 : 0);
      const available = budget - spent;
      const detail = available >= 0 ? `${money(available)} left` : `${money(Math.abs(available))} over`;
      return `<div class="progress"><div class="progress-meta"><strong>${name}</strong><span>${money(spent)} / ${money(budget)} · ${detail}</span></div><div class="track"><div class="fill ${spent > budget ? "over" : ""}" style="width:${pct}%"></div></div></div>`;
    }).join("");

    const daysInSelectedMonth = new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth() + 1, 0).getDate();
    const daysElapsedInSelectedMonth = isCurrentMonth ? today.getDate() : daysInSelectedMonth;
    const monthlyCategoryRows = Object.entries(categories).map(([name, weeklyBudget]) => {
      const dailyBudget = weeklyBudget / 7;
      const budget = dailyBudget * daysInSelectedMonth;
      const paceBudget = dailyBudget * daysElapsedInSelectedMonth;
      const spent = sumExpenses(monthInfo.start, monthInfo.effectiveEnd, name);
      return {name, budget, paceBudget, spent};
    });
    $("monthlyBreakdownTitle").textContent = `${selectedMonthDate.toLocaleDateString("en-US", {month:"long", year:"numeric"})} category breakdown`;
    $("monthlyBreakdownStatus").textContent = monthBalance >= 0
      ? (isCurrentMonth ? `${money(monthBalance)} remaining` : `${money(monthBalance)} unused`)
      : `${money(Math.abs(monthBalance))} over`;
    $("monthlyBreakdownStatus").classList.toggle("negative-text", monthBalance < 0);
    $("monthlyBreakdownStatus").classList.toggle("positive-text", monthBalance >= 0);
    $("monthlyCategoryProgress").innerHTML = monthlyCategoryRows.map(({name, budget, paceBudget, spent}) => {
      const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : (spent > 0 ? 100 : 0);
      const available = budget - spent;
      const detail = available >= 0 ? `${money(available)} remaining` : `${money(Math.abs(available))} over`;
      let paceDetail = "";
      if (isCurrentMonth) {
        const paceDiff = paceBudget - spent;
        paceDetail = paceDiff >= 0
          ? ` · ${money(paceDiff)} below today's pace`
          : ` · ${money(Math.abs(paceDiff))} above today's pace`;
      }
      return `<div class="progress"><div class="progress-meta"><strong>${name}</strong><span>${money(spent)} / ${money(budget)} full month · ${detail}${paceDetail}</span></div><div class="track"><div class="fill ${spent > budget ? "over" : ""}" style="width:${pct}%"></div></div></div>`;
    }).join("");

    const selectedWeekExpenses = expenses.filter(x => dateInRange(x.expense_date, start, end));
    $("selectedWeekExpensesTitle").textContent = `${isCurrentWeek ? "Expenses this week" : "Expenses in selected week"} · ${selectedWeekExpenses.length}`;
    $("recentExpenses").innerHTML = expenseItems(selectedWeekExpenses.slice(0, 10), false);
    renderWeeklyCloseout({start, end, totalBudget, baseBudget, carryIn, totalSpent, weeklyBalance, isCurrentWeek});
    renderWeeklyTrend();
    renderMonthlyTrend();
  }

  function closeoutAllocationDescription(row) {
    const amount = Number(row.allocation_amount || 0);
    if (row.allocation_type === "Savings") return `${money(amount)} to savings`;
    if (row.allocation_type === "Debt") return `${money(amount)} to ${row.debt_account || "debt"}`;
    if (row.allocation_type === "Carry Forward") return `${money(amount)} carried forward`;
    return `${money(amount)} left unallocated`;
  }

  function renderCloseoutHistory() {
    if (!closeoutsAvailable) {
      $("closeoutHistory").innerHTML = `<div class="empty">Run the weekly closeout Supabase setup SQL to enable closeouts.</div>`;
      return;
    }
    const rows = [...closeouts].sort((a,b) => b.week_start.localeCompare(a.week_start)).slice(0, 6);
    $("closeoutHistory").innerHTML = rows.length ? rows.map(x => {
      const end = x.week_end || addDays(x.week_start, 6);
      const remainder = Math.max(0, Number(x.unused_amount || 0) - Number(x.allocation_amount || 0));
      return `<div class="closeout-history-item"><div><strong>${localDate(x.week_start,{month:"short",day:"numeric"})} – ${localDate(end,{month:"short",day:"numeric"})}</strong><small>${escapeHtml(closeoutAllocationDescription(x))}${remainder > 0 ? ` · ${money(remainder)} remained unallocated` : ""}</small></div><span class="closeout-tag">${escapeHtml(x.allocation_type)}</span></div>`;
    }).join("") : `<div class="empty">No weeks closed out yet.</div>`;
  }

  function renderCloseoutAmountHint() {
    if ($("closeoutForm").classList.contains("hidden")) return;
    const max = Number($("closeoutAmount").max || 0);
    const amount = Math.max(0, Number($("closeoutAmount").value || 0));
    const remaining = Math.max(0, max - amount);
    $("closeoutAmountHelp").textContent = remaining > 0 ? `${money(remaining)} will remain unallocated.` : `All ${money(max)} is accounted for.`;
  }

  function toggleCloseoutDebtFields() {
    const isDebt = $("closeoutAllocation").value === "Debt";
    $("closeoutDebtFields").classList.toggle("hidden", !isDebt);
    $("closeoutDebtDate").required = isDebt;
    renderCloseoutAmountHint();
  }

  function renderWeeklyCloseout({start, end, totalBudget, baseBudget, carryIn, totalSpent, weeklyBalance, isCurrentWeek}) {
    const totals = closeoutTotals();
    $("closeoutSavingsTotal").textContent = money(totals.savings);
    $("closeoutDebtTotal").textContent = money(totals.debt);
    $("closeoutCarryIn").textContent = money(carryInForWeek(weekStartFor(new Date())));
    renderCloseoutHistory();

    const form = $("closeoutForm");
    const existing = closeoutForWeek(start);
    $("deleteCloseoutButton").classList.toggle("hidden", !existing);
    $("closeoutBadge").classList.remove("done", "warning");

    if (!closeoutsAvailable) {
      form.classList.add("hidden");
      $("closeoutBadge").textContent = "Setup needed";
      $("closeoutBadge").classList.add("warning");
      $("closeoutStatus").className = "closeout-status warning";
      $("closeoutStatus").textContent = "Weekly Closeout needs one Supabase table. Run supabase_weekly_closeouts.sql once, then refresh the app. Everything else will keep working until you do.";
      return;
    }

    const currentStart = weekStartFor(new Date());
    const completed = start < currentStart;
    if (!completed) {
      form.classList.add("hidden");
      $("closeoutBadge").textContent = "Week in progress";
      $("closeoutStatus").className = "closeout-status";
      $("closeoutStatus").textContent = `Closeout becomes available after ${localDate(end, {month:"short",day:"numeric"})}. Right now you have ${weeklyBalance >= 0 ? money(weeklyBalance) + " available" : money(Math.abs(weeklyBalance)) + " over budget"}.`;
      return;
    }

    if (weeklyBalance <= 0 && !existing) {
      form.classList.add("hidden");
      $("closeoutBadge").textContent = weeklyBalance < 0 ? "Over budget" : "No unused budget";
      $("closeoutBadge").classList.add("warning");
      $("closeoutStatus").className = "closeout-status warning";
      $("closeoutStatus").textContent = weeklyBalance < 0 ? `This week finished ${money(Math.abs(weeklyBalance))} over budget, so there is no unused amount to allocate.` : "This week used the full budget, so there is nothing to allocate.";
      return;
    }

    const available = Math.max(0, weeklyBalance);
    form.classList.remove("hidden");
    $("closeoutBudget").textContent = money(totalBudget);
    $("closeoutSpent").textContent = money(totalSpent);
    $("closeoutUnused").textContent = money(available);
    $("closeoutCarryUsed").textContent = carryIn > 0 ? money(carryIn) : "$0.00";
    $("closeoutAmount").max = String(available.toFixed(2));

    if (existing) {
      $("closeoutBadge").textContent = "Closed";
      $("closeoutBadge").classList.add("done");
      $("closeoutStatus").className = "closeout-status success";
      const remainder = Math.max(0, available - Number(existing.allocation_amount || 0));
      $("closeoutStatus").textContent = `${closeoutAllocationDescription(existing)}${remainder > 0 ? `, with ${money(remainder)} left unallocated.` : "."} You can update the decision below.`;
      $("closeoutAllocation").value = existing.allocation_type || "Savings";
      $("closeoutAmount").value = Math.min(available, Number(existing.allocation_amount || 0)).toFixed(2);
      $("closeoutDebtAccount").value = existing.debt_account || "Credit Card";
      $("closeoutDebtDate").value = existing.debt_payment_date || isoToday();
      $("closeoutNote").value = existing.note || "";
      $("saveCloseoutButton").textContent = "Update closeout";
    } else {
      $("closeoutBadge").textContent = "Ready to close";
      $("closeoutStatus").className = "closeout-status";
      $("closeoutStatus").textContent = `You finished this week with ${money(available)} unused. Choose what you actually did with that money.`;
      $("closeoutAllocation").value = "Savings";
      $("closeoutAmount").value = available.toFixed(2);
      $("closeoutDebtAccount").value = "Credit Card";
      $("closeoutDebtDate").value = isoToday();
      $("closeoutNote").value = "";
      $("saveCloseoutButton").textContent = "Save closeout";
    }
    toggleCloseoutDebtFields();
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

  function goToWeek(offset) {
    const current = weekStartFor(new Date());
    const candidate = addDays(selectedWeekStart || current, offset * 7);
    selectedWeekStart = candidate > current ? current : candidate;
    renderDashboard();
  }

  function goToMonth(offset) {
    const current = firstOfMonth(new Date());
    const base = selectedMonthDate || current;
    const candidate = addMonths(base, offset);
    selectedMonthDate = monthKey(candidate) > monthKey(current) ? current : candidate;
    renderDashboard();
  }

  function jumpToCurrentWeek() {
    selectedWeekStart = weekStartFor(new Date());
    renderDashboard();
  }

  function jumpToCurrentMonth() {
    selectedMonthDate = firstOfMonth(new Date());
    renderDashboard();
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

  async function saveWeeklyCloseout() {
    if (!closeoutsAvailable) return toast("Run the weekly closeout Supabase setup SQL first.");
    const start = selectedWeekStart || weekStartFor(new Date());
    const currentStart = weekStartFor(new Date());
    if (start >= currentStart) return toast("You can close a week after it ends.");
    const end = addDays(start, 6);
    const budget = weeklyBudgetForStart(start);
    const spent = sumExpenses(start, end);
    const unused = Math.max(0, budget - spent);
    if (unused <= 0) return toast("There is no unused budget to allocate.");

    const allocationType = $("closeoutAllocation").value;
    const allocationAmount = Number($("closeoutAmount").value || 0);
    if (!Number.isFinite(allocationAmount) || allocationAmount < 0 || allocationAmount > unused + 0.001) {
      return toast(`Enter an amount between $0 and ${money(unused)}.`);
    }
    const existing = closeoutForWeek(start);
    let debtPaymentId = existing?.debt_payment_id || null;
    let debtAccount = null;
    let debtPaymentDate = null;

    try {
      if (allocationType === "Debt" && allocationAmount > 0) {
        debtAccount = $("closeoutDebtAccount").value;
        debtPaymentDate = $("closeoutDebtDate").value || isoToday();
        const paymentRow = {
          user_id: currentUser.id,
          payment_date: debtPaymentDate,
          account: debtAccount,
          description: `Weekly closeout · ${localDate(start,{month:"short",day:"numeric"})}–${localDate(end,{month:"short",day:"numeric"})}`,
          amount: allocationAmount
        };
        if (debtPaymentId) {
          const { data: updated, error: updateError } = await db.from("debt_payments").update(paymentRow).eq("id", debtPaymentId).select("id").maybeSingle();
          if (updateError) throw updateError;
          if (!updated) debtPaymentId = null;
        }
        if (!debtPaymentId) {
          const { data: inserted, error: insertError } = await db.from("debt_payments").insert(paymentRow).select("id").single();
          if (insertError) throw insertError;
          debtPaymentId = String(inserted.id);
        }
      } else if (debtPaymentId) {
        const { error: deleteDebtError } = await db.from("debt_payments").delete().eq("id", debtPaymentId);
        if (deleteDebtError) throw deleteDebtError;
        debtPaymentId = null;
      }

      const row = {
        user_id: currentUser.id,
        week_start: start,
        week_end: end,
        budget_amount: budget,
        spent_amount: spent,
        unused_amount: unused,
        allocation_type: allocationType,
        allocation_amount: allocationAmount,
        debt_account: debtAccount,
        debt_payment_id: debtPaymentId,
        debt_payment_date: debtPaymentDate,
        note: $("closeoutNote").value.trim() || null,
        updated_at: new Date().toISOString()
      };
      const { error } = await db.from("weekly_closeouts").upsert(row, {onConflict:"user_id,week_start"});
      if (error) throw error;
      toast(existing ? "Weekly closeout updated." : "Week closed out.");
      await loadAll();
    } catch (err) {
      console.error(err);
      toast(err.message || "Unable to save closeout.");
    }
  }

  async function deleteWeeklyCloseout() {
    const start = selectedWeekStart || weekStartFor(new Date());
    const existing = closeoutForWeek(start);
    if (!existing) return;
    if (!confirm("Delete this weekly closeout? Any linked debt payment created by the closeout will also be removed.")) return;
    try {
      if (existing.debt_payment_id) {
        const { error: debtError } = await db.from("debt_payments").delete().eq("id", existing.debt_payment_id);
        if (debtError) throw debtError;
      }
      const { error } = await db.from("weekly_closeouts").delete().eq("id", existing.id);
      if (error) throw error;
      toast("Closeout deleted.");
      await loadAll();
    } catch (err) {
      toast(err.message || "Unable to delete closeout.");
    }
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
  $("prevWeekButton").onclick = () => goToWeek(-1);
  $("nextWeekButton").onclick = () => goToWeek(1);
  $("thisWeekButton").onclick = jumpToCurrentWeek;
  $("prevMonthButton").onclick = () => goToMonth(-1);
  $("nextMonthButton").onclick = () => goToMonth(1);
  $("thisMonthButton").onclick = jumpToCurrentMonth;
  $("contributionYear").onchange = renderContributions;
  $("closeoutAllocation").onchange = toggleCloseoutDebtFields;
  $("closeoutAmount").oninput = renderCloseoutAmountHint;
  $("closeoutForm").addEventListener("submit", async e => { e.preventDefault(); await saveWeeklyCloseout(); });
  $("deleteCloseoutButton").onclick = deleteWeeklyCloseout;
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
    selectedWeekStart = null;
    toast("Settings saved.");
    await loadAll();
  });

  document.addEventListener("click", async e => {
    const weekButton = e.target.closest("[data-week-start]");
    const monthButton = e.target.closest("[data-month-start]");
    if (weekButton) {
      selectedWeekStart = weekButton.dataset.weekStart;
      renderDashboard();
      return;
    }
    if (monthButton) {
      selectedMonthDate = firstOfMonth(parseLocalDate(monthButton.dataset.monthStart));
      renderDashboard();
      return;
    }
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
      if (closeoutsAvailable) {
        await db.from("weekly_closeouts").update({debt_payment_id:null, updated_at:new Date().toISOString()}).eq("debt_payment_id", String(debtId));
      }
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
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js?v=8").catch(console.error));
  }
})();
