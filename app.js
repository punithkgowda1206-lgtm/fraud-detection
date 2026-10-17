const money = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);

const timeFmt = (iso) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));

const state = {
  route: "overview",
  transactions: [],
  stats: null,
  analytics: null,
  alerts: [],
  alertFilter: "pending",
  selectedId: null,
  simulatorOn: true,
};

const titles = {
  overview: ["Overview", "Stop suspicious transactions before they become a chargeback."],
  monitor: ["Live monitor", "Every authorization is scored against customer baselines in flight."],
  alerts: ["Alert queue", "Held payments waiting for an analyst before money can move."],
  lab: ["Score a payment", "Push a transaction through the same engine the live stream uses."],
  how: ["How it works", "Real-time transactional AI in the authorization window."],
};

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>⚡</span> <span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function badge(decision) {
  return `<span class="badge ${decision}">${decision}</span>`;
}

function renderKpis() {
  const stats = state.stats || {};
  const items = [
    ["Payments scored", stats.processed ?? "—"],
    ["Loss prevented", money(stats.preventedLoss)],
    ["Held for review", stats.heldOpen ?? "—"],
    ["Block rate", `${stats.blockRate ?? 0}%`],
  ];
  document.getElementById("kpi-grid").innerHTML = items
    .map(([label, value]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderMix() {
  const buckets = state.analytics?.buckets || { approve: 0, review: 0, block: 0 };
  const total = Math.max(1, buckets.approve + buckets.review + buckets.block);
  document.getElementById("mix-bars").innerHTML = ["approve", "review", "block"]
    .map((key) => {
      const pct = Math.round((buckets[key] / total) * 100);
      return `<div class="bar-row"><span>${key}</span><div class="track"><div class="fill ${key}" style="width:${pct}%"></div></div><span>${pct}%</span></div>`;
    })
    .join("");

  document.getElementById("reason-list").innerHTML = (state.analytics?.topReasons || [])
    .map(
      (row) =>
        `<div class="reason-row"><span>${row.code.replaceAll("_", " ")}</span><strong>${row.count}</strong></div>`
    )
    .join("") || `<p class="muted">Signals appear as payments are scored.</p>`;
}

function renderOverviewTable() {
  document.getElementById("overview-rows").innerHTML = state.transactions
    .slice(0, 10)
    .map(
      (txn) => `<tr data-id="${txn.id}">
        <td>${timeFmt(txn.timestamp)}</td>
        <td>${txn.userName}</td>
        <td>${txn.merchant}</td>
        <td>${money(txn.amount)}</td>
        <td>${txn.score}</td>
        <td>${badge(txn.decision)}</td>
        <td><span class="badge ${txn.status}">${txn.status.replace('-', ' ')}</span></td>
      </tr>`
    )
    .join("");
}

function renderMonitor() {
  const q = document.getElementById("search").value.toLowerCase();
  const decision = document.getElementById("decision-filter").value;
  const status = document.getElementById("status-filter").value;
  const rows = state.transactions.filter((txn) => {
    if (decision && txn.decision !== decision) return false;
    if (status && txn.status !== status) return false;
    if (!q) return true;
    return `${txn.id} ${txn.userName} ${txn.merchant} ${txn.country}`.toLowerCase().includes(q);
  });

  document.getElementById("monitor-rows").innerHTML = rows
    .slice(0, 80)
    .map(
      (txn) => `<tr data-id="${txn.id}" class="${state.selectedId === txn.id ? "selected" : ""}">
        <td>${txn.id}</td>
        <td>${txn.userName}</td>
        <td>${txn.merchant}</td>
        <td>${txn.city}, ${txn.country}</td>
        <td>${money(txn.amount)}</td>
        <td>${txn.score}</td>
        <td>${badge(txn.decision)}</td>
        <td><span class="badge ${txn.status}">${txn.status.replace('-', ' ')}</span></td>
      </tr>`
    )
    .join("");

  const selected = state.transactions.find((txn) => txn.id === state.selectedId);
  document.getElementById("inspect-panel").innerHTML = selected
    ? inspectHtml(selected)
    : `<p class="muted">Select a payment to inspect the model reasons.</p>`;
}

function inspectHtml(txn) {
  const reasons = (txn.reasons || [])
    .map((reason) => `<div class="reason-row"><span>${reason.detail}</span><strong>+${reason.weight}</strong></div>`)
    .join("") || `<p class="muted">No elevated signals. Looks like this customer's normal pattern.</p>`;

  let holdExplanation = "";
  if (txn.status === "cleared") {
    holdExplanation = "✅ <strong>Hold Released:</strong> Payment cleared by analyst for settlement.";
  } else if (txn.status === "confirmed-fraud") {
    holdExplanation = "🚫 <strong>Fraud Confirmed:</strong> Transaction locked permanently. Loss prevented.";
  } else if (txn.status === "held") {
    holdExplanation = "⚠️ <strong>Authorization Held:</strong> Funds held in flight awaiting review.";
  } else {
    holdExplanation = "ℹ️ <strong>Settled:</strong> Normal authorization completed. Loss window closed.";
  }

  return `
    <div class="panel-head">
      <h2>${txn.id}</h2>
      <div style="display:flex; gap:6px; align-items:center;">
        ${badge(txn.decision)}
        <span class="badge ${txn.status}">${txn.status.replace('-', ' ')}</span>
      </div>
    </div>
    <p><strong>${txn.userName}</strong> · ${txn.merchant}<br>${money(txn.amount)} · ${txn.city || 'Unknown'}, ${txn.country}</p>
    <p class="hint">${holdExplanation}</p>
    <p>Score <strong>${txn.score}</strong> / 100 · Device: ${txn.device} · ${txn.channel}</p>
    <div style="margin: 12px 0;">${reasons}</div>
    <div class="actions" data-id="${txn.id}">
      <button class="btn-clear ${txn.status === 'cleared' ? 'active' : ''}" data-action="cleared">Clear / Settle</button>
      <button class="btn-fraud ${txn.status === 'confirmed-fraud' ? 'active' : ''}" data-action="confirmed-fraud">Confirm Fraud</button>
      <button class="btn-hold ${txn.status === 'held' ? 'active' : ''}" data-action="held">Keep Hold</button>
    </div>
  `;
}

function renderAlerts() {
  document.querySelectorAll("#alert-tabs button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === state.alertFilter);
  });

  document.getElementById("alert-list").innerHTML = state.alerts
    .map((alert) => {
      let actionButtons = "";
      if (alert.status === "held") {
        actionButtons = `
          <button class="btn-clear" data-alert="${alert.id}" data-action="cleared">Release Hold</button>
          <button class="btn-fraud" data-alert="${alert.id}" data-action="confirmed-fraud">Confirm Fraud</button>
        `;
      } else if (alert.status === "cleared") {
        actionButtons = `
          <span class="badge cleared">Hold Released</span>
          <button class="btn-hold" data-alert="${alert.id}" data-action="held">Re-Hold</button>
        `;
      } else if (alert.status === "confirmed-fraud") {
        actionButtons = `
          <span class="badge confirmed-fraud">Fraud Confirmed</span>
          <button class="btn-clear" data-alert="${alert.id}" data-action="cleared">Reverse Flag</button>
        `;
      }

      return `<article class="alert-card panel">
        <div class="alert-top">
          <div>
            <div style="display:flex; gap:6px; align-items:center;">
              <span class="badge ${alert.severity}">${alert.severity}</span>
              <span class="badge ${alert.status}">${alert.status.replace('-', ' ')}</span>
            </div>
            <h2 style="margin:8px 0 4px">${alert.title}</h2>
            <p class="muted">${alert.userName} · ${alert.merchant} · ${money(alert.amount)}</p>
          </div>
          <div>
            ${badge(alert.score >= 72 ? "block" : "review")}
            <div class="muted" style="margin-top:6px; font-size:12px; text-align:right;">${timeFmt(alert.timestamp)}</div>
          </div>
        </div>
        <div class="reason-pills">${(alert.reasons || []).map((reason) => `<span class="pill">${reason.code.replaceAll("_", " ")} (+${reason.weight})</span>`).join("")}</div>
        <div class="actions">
          ${actionButtons}
        </div>
      </article>`;
    })
    .join("") || `<article class="panel"><p class="muted">No ${state.alertFilter} alerts found.</p></article>`;
}

function renderLabResult(txn) {
  document.getElementById("lab-result").innerHTML = inspectHtml(txn);
}

function setSimulatorUi() {
  document.getElementById("sim-dot").classList.toggle("off", !state.simulatorOn);
  document.getElementById("sim-label").textContent = state.simulatorOn ? "Live feed on" : "Live feed paused";
  document.getElementById("sim-toggle").textContent = state.simulatorOn ? "Pause stream" : "Resume stream";
}

function showRoute(route) {
  state.route = route;
  document.querySelectorAll("nav button").forEach((btn) => btn.classList.toggle("active", btn.dataset.route === route));
  document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
  document.getElementById(`view-${route}`).classList.remove("hidden");
  const [title, sub] = titles[route];
  document.getElementById("page-title").textContent = title;
  document.getElementById("page-sub").textContent = sub;
  if (route === "monitor") renderMonitor();
  if (route === "alerts") renderAlerts();
}

async function refresh() {
  try {
    const [stats, analytics, transactions, alerts] = await Promise.all([
      api("/api/stats"),
      api("/api/analytics"),
      api("/api/transactions?limit=120"),
      api(`/api/alerts?filter=${state.alertFilter}`),
    ]);
    state.stats = stats;
    state.analytics = analytics;
    state.transactions = transactions;
    state.alerts = alerts;
    state.simulatorOn = Boolean(stats.simulator?.running);
    renderKpis();
    renderMix();
    renderOverviewTable();
    if (state.route === "monitor") renderMonitor();
    if (state.route === "alerts") renderAlerts();
    setSimulatorUi();

    if (state.selectedId) {
      const selected = state.transactions.find((txn) => txn.id === state.selectedId);
      if (selected) {
        if (state.route === "monitor") {
          const inspect = document.getElementById("inspect-panel");
          if (inspect) inspect.innerHTML = inspectHtml(selected);
        }
        if (state.route === "lab") {
          const labResult = document.getElementById("lab-result");
          if (labResult && labResult.querySelector(".panel-head")) {
            labResult.innerHTML = inspectHtml(selected);
          }
        }
      }
    }
  } catch (err) {
    console.error("Refresh error:", err);
  }
}

function upsertTransaction(txn) {
  const idx = state.transactions.findIndex((entry) => entry.id === txn.id);
  if (idx >= 0) {
    state.transactions[idx] = { ...state.transactions[idx], ...txn };
  } else {
    state.transactions = [txn, ...state.transactions].slice(0, 200);
  }
}

async function updateStatus(id, status) {
  try {
    const txn = await api(`/api/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    upsertTransaction(txn);
    showToast(`Updated ${id} to ${status.toUpperCase()}`);
    await refresh();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function handleActionClick(event) {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  const container = btn.closest(".actions");
  const id = container?.dataset.id || state.selectedId;
  const action = btn.dataset.action;
  if (id && action) {
    updateStatus(id, action);
  }
}

document.querySelector("nav").addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-route]");
  if (btn) showRoute(btn.dataset.route);
});

document.getElementById("sim-toggle").addEventListener("click", async () => {
  await api(state.simulatorOn ? "/api/simulator/stop" : "/api/simulator/start", { method: "POST" });
  await refresh();
});

document.getElementById("search").addEventListener("input", renderMonitor);
document.getElementById("decision-filter").addEventListener("change", renderMonitor);
document.getElementById("status-filter").addEventListener("change", renderMonitor);

document.getElementById("overview-rows").addEventListener("click", (event) => {
  const id = event.target.closest("tr")?.dataset.id;
  if (!id) return;
  state.selectedId = id;
  showRoute("monitor");
  renderMonitor();
});

document.getElementById("monitor-rows").addEventListener("click", (event) => {
  const id = event.target.closest("tr")?.dataset.id;
  if (!id) return;
  state.selectedId = id;
  renderMonitor();
});

document.getElementById("inspect-panel").addEventListener("click", handleActionClick);
document.getElementById("lab-result").addEventListener("click", handleActionClick);

document.getElementById("alert-tabs")?.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-filter]");
  if (!btn) return;
  state.alertFilter = btn.dataset.filter;
  await refresh();
});

document.getElementById("alert-list").addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-alert]");
  if (btn) updateStatus(btn.dataset.alert, btn.dataset.action);
});

document.getElementById("score-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitBtn = event.target.querySelector("button[type='submit']");
  const origText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Scoring transaction in ~100ms...";

  try {
    const form = new FormData(event.target);
    const payload = Object.fromEntries(form.entries());
    payload.amount = Number(payload.amount);
    const txn = await api("/api/transactions", { method: "POST", body: JSON.stringify(payload) });
    state.selectedId = txn.id;
    upsertTransaction(txn);
    renderLabResult(txn);
    showToast(`Payment ${txn.id} scored: ${txn.decision.toUpperCase()} (${txn.score}/100)`);
    await refresh();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = origText;
  }
});

const PRESETS = {
  normal: {
    merchant: "FreshMart",
    category: "Grocery",
    amount: 45.2,
    country: "IN",
    city: "Bengaluru",
    device: "Pixel 8 · Chrome",
    channel: "pos",
  },
  travel: {
    merchant: "Emirates",
    category: "Travel",
    amount: 1200.0,
    country: "AE",
    city: "Dubai",
    device: "iPhone 16 · Safari",
    channel: "web",
  },
  attack: {
    merchant: "CryptoRush OTC",
    category: "Crypto",
    amount: 14500.0,
    country: "RU",
    city: "Moscow",
    device: "Windows VM · Chrome",
    channel: "web",
  },
};

document.querySelector(".presets-container")?.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-preset]");
  if (!btn) return;
  const preset = PRESETS[btn.dataset.preset];
  if (!preset) return;
  const form = document.getElementById("score-form");
  for (const [key, val] of Object.entries(preset)) {
    if (form.elements[key]) form.elements[key].value = val;
  }
  showToast(`Loaded ${btn.dataset.preset} scenario`);
});

async function loadUsers() {
  const users = await api("/api/users");
  document.getElementById("user-select").innerHTML = users
    .map((user) => `<option value="${user.id}">${user.name} · ${user.homeCountry} (avg $${user.avgAmount})</option>`)
    .join("");
}

const stream = new EventSource("/api/stream");
stream.addEventListener("transaction", (event) => {
  try {
    const txn = JSON.parse(event.data);
    upsertTransaction(txn);
    renderKpis();
    renderOverviewTable();
    if (state.route === "monitor") renderMonitor();
    if (state.route === "alerts" && state.alertFilter === "pending" && txn.decision !== "approve") {
      refresh();
    }
  } catch (e) {
    console.error("SSE parse error", e);
  }
});

loadUsers()
  .then(refresh)
  .catch((err) => {
    document.getElementById(
      "kpi-grid"
    ).innerHTML = `<div class="kpi"><span>Backend error</span><strong>${err.message}</strong></div>`;
  });
