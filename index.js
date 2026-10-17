const path = require("path");
const express = require("express");
const { store } = require("./store");
const { seed, insertScored } = require("./seed");
const { scoreTransaction } = require("./engine");
const simulator = require("./simulator");

seed();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  next(err);
});

function stats() {
  const txns = store.transactions;
  const blocked = txns.filter((txn) => txn.decision === "block");
  const review = txns.filter((txn) => txn.decision === "review");
  const approved = txns.filter((txn) => txn.decision === "approve");
  const prevented = blocked.reduce((sum, txn) => sum + txn.amount, 0);
  const volume = txns.reduce((sum, txn) => sum + txn.amount, 0);

  return {
    processed: txns.length,
    approved: approved.length,
    review: review.length,
    blocked: blocked.length,
    volume: Number(volume.toFixed(2)),
    preventedLoss: Number(prevented.toFixed(2)),
    blockRate: txns.length ? Number(((blocked.length / txns.length) * 100).toFixed(1)) : 0,
    heldOpen: txns.filter((txn) => txn.status === "held").length,
    simulator: store.simulator,
  };
}

function analytics() {
  const buckets = { approve: 0, review: 0, block: 0 };
  const reasons = {};
  const hourly = Array.from({ length: 12 }, (_, index) => ({
    label: `${index * 2}h`,
    count: 0,
    blocked: 0,
  }));

  for (const txn of store.transactions) {
    buckets[txn.decision] += 1;
    for (const reason of txn.reasons) {
      reasons[reason.code] = (reasons[reason.code] || 0) + 1;
    }
    const ageHours = Math.min(11, Math.floor((Date.now() - new Date(txn.timestamp)) / 3600000 / 2));
    const slot = hourly[11 - ageHours];
    slot.count += 1;
    if (txn.decision === "block") slot.blocked += 1;
  }

  const topReasons = Object.entries(reasons)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return { buckets, topReasons, hourly, users: store.users };
}

function filterTransactions(query) {
  const decision = query.decision;
  const status = query.status;
  const q = (query.q || "").toLowerCase().trim();

  return store.transactions.filter((txn) => {
    if (decision && txn.decision !== decision) return false;
    if (status && txn.status !== status) return false;
    if (!q) return true;
    const haystack = `${txn.id} ${txn.userName} ${txn.merchant} ${txn.country} ${txn.category}`.toLowerCase();
    return haystack.includes(q);
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "sentinel-fraud" });
});

app.get("/api/stats", (_req, res) => {
  res.json(stats());
});

app.get("/api/analytics", (_req, res) => {
  res.json(analytics());
});

app.get("/api/users", (_req, res) => {
  res.json(store.users);
});

app.get("/api/transactions", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 80, 200);
  res.json(filterTransactions(req.query).slice(0, limit));
});

app.get("/api/transactions/:id", (req, res) => {
  const txn = store.transactions.find((entry) => entry.id === req.params.id);
  if (!txn) return res.status(404).json({ error: "Transaction not found" });
  const related = store.transactions
    .filter((entry) => entry.userId === txn.userId && entry.id !== txn.id)
    .slice(0, 8);
  res.json({ ...txn, related });
});

app.post("/api/transactions", (req, res) => {
  const body = req.body || {};
  const user = store.users.find((entry) => entry.id === body.userId) || store.users[0];
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }

  const input = {
    userId: user.id,
    userName: user.name,
    merchant: (body.merchant || "Manual Entry").trim(),
    category: (body.category || "Other").trim(),
    amount: Number(amount.toFixed(2)),
    currency: "USD",
    country: (body.country || user.homeCountry || "US").toUpperCase(),
    city: (body.city || "Unknown").trim(),
    device: (body.device || user.primaryDevice || "Unknown").trim(),
    channel: body.channel || "web",
    cardLast4: body.cardLast4 || String(1000 + Math.floor(Math.random() * 9000)),
    ip: body.ip || "10.0.0.12",
    timestamp: new Date().toISOString(),
  };

  const txn = insertScored(input);
  store.transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  simulator.broadcast("transaction", txn);
  res.status(201).json(txn);
});

app.post("/api/score", (req, res) => {
  const body = req.body || {};
  const user = store.users.find((entry) => entry.id === body.userId) || store.users[0];
  const input = {
    userId: user.id,
    userName: user.name,
    merchant: body.merchant,
    category: body.category,
    amount: Number(body.amount),
    currency: "USD",
    country: body.country,
    city: body.city || "Unknown",
    device: body.device || user.primaryDevice,
    channel: body.channel || "web",
    cardLast4: "0000",
    ip: "127.0.0.1",
    timestamp: new Date().toISOString(),
  };
  if (!input.merchant || !Number.isFinite(input.amount)) {
    return res.status(400).json({ error: "merchant and amount are required" });
  }
  res.json(scoreTransaction(store, input));
});

app.patch("/api/transactions/:id", (req, res) => {
  const txn = store.transactions.find((entry) => entry.id === req.params.id);
  if (!txn) return res.status(404).json({ error: "Transaction not found" });

  const { status, analystNote } = req.body || {};
  const allowed = ["held", "cleared", "confirmed-fraud", "settled"];
  if (status && !allowed.includes(status)) {
    return res.status(400).json({ error: "invalid status" });
  }
  if (status) {
    txn.status = status;
    if (status === "cleared" || status === "settled") {
      txn.holdBeforeSettlement = false;
    } else if (status === "held" || status === "confirmed-fraud") {
      txn.holdBeforeSettlement = true;
    }
  }
  if (typeof analystNote === "string") txn.analystNote = analystNote;
  simulator.broadcast("transaction", txn);
  res.json(txn);
});

app.get("/api/alerts", (req, res) => {
  const filter = req.query.filter || "pending";
  const list = store.transactions.filter((txn) => {
    if (txn.decision === "approve") return false;
    if (filter === "pending") return txn.status === "held";
    if (filter === "resolved") return txn.status === "cleared" || txn.status === "confirmed-fraud";
    return true; // all
  });
  const alerts = list.slice(0, 50).map((txn) => ({
    id: txn.id,
    severity: txn.decision === "block" ? "critical" : "warning",
    title: txn.decision === "block" ? "Payment blocked before settlement" : "Sent to review queue",
    userName: txn.userName,
    amount: txn.amount,
    merchant: txn.merchant,
    score: txn.score,
    timestamp: txn.timestamp,
    status: txn.status,
    decision: txn.decision,
    reasons: txn.reasons,
    analystNote: txn.analystNote || "",
  }));
  res.json(alerts);
});

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const unsubscribe = simulator.subscribe(res);
  req.on("close", unsubscribe);
});

app.get("/api/simulator", (_req, res) => {
  res.json(store.simulator);
});

app.post("/api/simulator/start", (_req, res) => {
  res.json(simulator.start());
});

app.post("/api/simulator/stop", (_req, res) => {
  res.json(simulator.stop());
});

app.listen(PORT, () => {
  simulator.start();
  console.log(`Sentinel Fraud listening on http://localhost:${PORT}`);
});