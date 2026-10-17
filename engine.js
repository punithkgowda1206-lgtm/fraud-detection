const WEIGHTS = {
  amountVsBaseline: 22,
  highValue: 12,
  velocity: 20,
  geoMismatch: 18,
  nightHighValue: 10,
  rareCategory: 8,
  newDevice: 10,
  cardTesting: 24,
  riskyMerchant: 16,
  internationalJump: 14,
};

const RISKY_MERCHANTS = new Set([
  "CryptoRush OTC",
  "NightWire Transfers",
  "LuckySpin Casino",
  "GhostMarket Goods",
]);

function hourOf(iso) {
  return new Date(iso).getUTCHours();
}

function minutesBetween(a, b) {
  return Math.abs(new Date(a) - new Date(b)) / 60000;
}

function userHistory(store, userId, beforeIso) {
  return store.transactions
    .filter((txn) => txn.userId === userId && txn.timestamp < beforeIso)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function profileFromHistory(user, history) {
  const safeUser = user || {
    avgAmount: 300,
    homeCountry: "US",
    primaryDevice: "Unknown",
    usualCategories: [],
  };
  const amounts = history.map((txn) => txn.amount).filter((a) => typeof a === "number" && !isNaN(a));
  const avgAmount =
    amounts.length > 0
      ? amounts.reduce((sum, value) => sum + value, 0) / amounts.length
      : safeUser.avgAmount || 300;

  return {
    avgAmount,
    homeCountry: safeUser.homeCountry || "US",
    countries: new Set([safeUser.homeCountry, ...history.map((txn) => txn.country)].filter(Boolean)),
    devices: new Set([safeUser.primaryDevice, ...history.map((txn) => txn.device)].filter(Boolean)),
    categories: new Set([...(safeUser.usualCategories || []), ...history.map((txn) => txn.category)].filter(Boolean)),
  };
}

function scoreTransaction(store, input) {
  const ts = input.timestamp || new Date().toISOString();
  const history = userHistory(store, input.userId, ts);
  const user = store.users.find((entry) => entry.id === input.userId) || {
    id: input.userId || "u_guest",
    name: input.userName || "Guest Customer",
    homeCountry: input.country || "US",
    primaryDevice: input.device || "Unknown",
    avgAmount: 300,
    usualCategories: [],
  };
  const profile = profileFromHistory(user, history);
  const reasons = [];
  let score = 4;

  const validAmount = Number.isFinite(input.amount) && input.amount > 0 ? Number(input.amount) : 1;
  const amountRatio = validAmount / Math.max(profile.avgAmount, 1);
  if (amountRatio >= 6) {
    score += WEIGHTS.amountVsBaseline;
    reasons.push({
      code: "amount_vs_baseline",
      weight: WEIGHTS.amountVsBaseline,
      detail: `Amount is ${amountRatio.toFixed(1)}x this customer's usual spend`,
    });
  } else if (amountRatio >= 3) {
    const weight = Math.round(WEIGHTS.amountVsBaseline * 0.6);
    score += weight;
    reasons.push({
      code: "amount_vs_baseline",
      weight,
      detail: `Amount is ${amountRatio.toFixed(1)}x this customer's usual spend`,
    });
  }

  if (input.amount >= 7500) {
    score += WEIGHTS.highValue;
    reasons.push({
      code: "high_value",
      weight: WEIGHTS.highValue,
      detail: "High-value transfer that would settle immediately if approved",
    });
  }

  const recent = history.filter((txn) => minutesBetween(txn.timestamp, input.timestamp) <= 8);
  if (recent.length >= 3) {
    score += WEIGHTS.velocity;
    reasons.push({
      code: "velocity",
      weight: WEIGHTS.velocity,
      detail: `${recent.length + 1} payments from the same card in 8 minutes`,
    });
  }

  if (!profile.countries.has(input.country)) {
    score += WEIGHTS.geoMismatch;
    reasons.push({
      code: "geo_mismatch",
      weight: WEIGHTS.geoMismatch,
      detail: `First seen country ${input.country} vs home ${user.homeCountry}`,
    });
  }

  const hour = hourOf(input.timestamp);
  if ((hour <= 4 || hour >= 23) && input.amount >= 1800) {
    score += WEIGHTS.nightHighValue;
    reasons.push({
      code: "night_high_value",
      weight: WEIGHTS.nightHighValue,
      detail: "Large payment during a low-activity overnight window",
    });
  }

  if (!profile.categories.has(input.category) && input.amount >= 400) {
    score += WEIGHTS.rareCategory;
    reasons.push({
      code: "rare_category",
      weight: WEIGHTS.rareCategory,
      detail: `Unusual merchant category: ${input.category}`,
    });
  }

  if (!profile.devices.has(input.device)) {
    score += WEIGHTS.newDevice;
    reasons.push({
      code: "new_device",
      weight: WEIGHTS.newDevice,
      detail: `Unrecognized device fingerprint: ${input.device}`,
    });
  }

  const tinyRecent = recent.filter((txn) => txn.amount <= 4.5);
  if (tinyRecent.length >= 2 && input.amount >= 900) {
    score += WEIGHTS.cardTesting;
    reasons.push({
      code: "card_testing",
      weight: WEIGHTS.cardTesting,
      detail: "Micro-authorizations followed by a large charge (card testing)",
    });
  }

  if (RISKY_MERCHANTS.has(input.merchant)) {
    score += WEIGHTS.riskyMerchant;
    reasons.push({
      code: "risky_merchant",
      weight: WEIGHTS.riskyMerchant,
      detail: `${input.merchant} is on the elevated-risk merchant list`,
    });
  }

  if (input.country !== user.homeCountry && input.amount >= 2500) {
    score += WEIGHTS.internationalJump;
    reasons.push({
      code: "international_jump",
      weight: WEIGHTS.internationalJump,
      detail: "Cross-border jump on a high-value payment",
    });
  }

  score = Math.max(1, Math.min(99, Math.round(score)));

  let decision = "approve";
  if (score >= 72) decision = "block";
  else if (score >= 42) decision = "review";

  return {
    score,
    decision,
    reasons,
    preventedLoss: decision === "block" ? input.amount : 0,
    holdBeforeSettlement: decision !== "approve",
  };
}

module.exports = { scoreTransaction, RISKY_MERCHANTS };
