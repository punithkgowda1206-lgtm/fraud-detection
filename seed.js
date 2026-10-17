const { store } = require("./store");
const { scoreTransaction } = require("./engine");

const USERS = [
  {
    id: "u_ananya",
    name: "Ananya Rao",
    homeCountry: "IN",
    primaryDevice: "Pixel 8 · Chrome",
    avgAmount: 2400,
    usualCategories: ["Grocery", "Travel", "Utilities"],
  },
  {
    id: "u_marcus",
    name: "Marcus Hill",
    homeCountry: "US",
    primaryDevice: "iPhone 16 · Safari",
    avgAmount: 180,
    usualCategories: ["Dining", "Ride share", "Streaming"],
  },
  {
    id: "u_sofia",
    name: "Sofia Alvarez",
    homeCountry: "ES",
    primaryDevice: "MacBook · Firefox",
    avgAmount: 620,
    usualCategories: ["Retail", "Travel", "Dining"],
  },
  {
    id: "u_kenji",
    name: "Kenji Mori",
    homeCountry: "JP",
    primaryDevice: "Galaxy S24 · Chrome",
    avgAmount: 95,
    usualCategories: ["Transit", "Convenience", "Streaming"],
  },
  {
    id: "u_leila",
    name: "Leila Haddad",
    homeCountry: "AE",
    primaryDevice: "iPhone 15 · Safari",
    avgAmount: 1400,
    usualCategories: ["Luxury", "Travel", "Dining"],
  },
  {
    id: "u_owen",
    name: "Owen Blake",
    homeCountry: "GB",
    primaryDevice: "Pixel 9 · Chrome",
    avgAmount: 75,
    usualCategories: ["Grocery", "Fuel", "Utilities"],
  },
];

const MERCHANTS = [
  { name: "FreshMart", category: "Grocery", country: "IN", city: "Bengaluru" },
  { name: "Indigo Air", category: "Travel", country: "IN", city: "Delhi" },
  { name: "CityGrid Power", category: "Utilities", country: "IN", city: "Hyderabad" },
  { name: "BlueBottle", category: "Dining", country: "US", city: "San Francisco" },
  { name: "Lyft", category: "Ride share", country: "US", city: "Austin" },
  { name: "Netflix", category: "Streaming", country: "US", city: "Los Angeles" },
  { name: "Zara", category: "Retail", country: "ES", city: "Madrid" },
  { name: "Iberia", category: "Travel", country: "ES", city: "Barcelona" },
  { name: "Suica Transit", category: "Transit", country: "JP", city: "Tokyo" },
  { name: "Lawson", category: "Convenience", country: "JP", city: "Osaka" },
  { name: "Emirates", category: "Travel", country: "AE", city: "Dubai" },
  { name: "Galeries Lafayette", category: "Luxury", country: "AE", city: "Dubai" },
  { name: "Tesco", category: "Grocery", country: "GB", city: "London" },
  { name: "BP Connect", category: "Fuel", country: "GB", city: "Manchester" },
  { name: "CryptoRush OTC", category: "Crypto", country: "EE", city: "Tallinn" },
  { name: "LuckySpin Casino", category: "Gambling", country: "MT", city: "Valletta" },
  { name: "NightWire Transfers", category: "Money movement", country: "NG", city: "Lagos" },
  { name: "GhostMarket Goods", category: "Marketplace", country: "RU", city: "Moscow" },
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function makeBaseTransaction(user, merchant, overrides = {}) {
  return {
    userId: user.id,
    userName: user.name,
    merchant: merchant.name,
    category: merchant.category,
    amount: Number((user.avgAmount * (0.4 + Math.random() * 1.1)).toFixed(2)),
    currency: "USD",
    country: merchant.country,
    city: merchant.city,
    device: user.primaryDevice,
    channel: pick(["app", "web", "pos"]),
    cardLast4: String(1000 + Math.floor(Math.random() * 9000)),
    ip: `${20 + Math.floor(Math.random() * 80)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
    timestamp: isoMinutesAgo(Math.floor(Math.random() * 720)),
    ...overrides,
  };
}

function insertScored(input) {
  const result = scoreTransaction(store, input);
  const txn = {
    id: `txn_${String(store.nextTxnId++).padStart(4, "0")}`,
    ...input,
    ...result,
    status: result.decision === "approve" ? "settled" : "held",
    analystNote: "",
  };
  store.transactions.push(txn);
  if (store.transactions.length > 500) {
    store.transactions.splice(0, store.transactions.length - 500);
  }
  return txn;
}

function seed() {
  store.users = USERS.map((user) => ({ ...user }));
  store.transactions = [];
  store.nextTxnId = 1;

  for (const user of store.users) {
    const localMerchants = MERCHANTS.filter((merchant) => merchant.country === user.homeCountry);
    for (let i = 0; i < 6; i += 1) {
      insertScored(
        makeBaseTransaction(user, pick(localMerchants.length ? localMerchants : MERCHANTS), {
          timestamp: isoMinutesAgo(1800 - i * 80 - Math.floor(Math.random() * 40)),
          amount: Number((user.avgAmount * (0.3 + Math.random() * 0.9)).toFixed(2)),
        })
      );
    }
  }

  const ananya = store.users[0];
  const marcus = store.users[1];
  const owen = store.users[5];

  insertScored(
    makeBaseTransaction(marcus, MERCHANTS.find((m) => m.name === "Lyft"), {
      amount: 2.17,
      timestamp: isoMinutesAgo(16),
      channel: "web",
    })
  );
  insertScored(
    makeBaseTransaction(marcus, MERCHANTS.find((m) => m.name === "Netflix"), {
      amount: 1.04,
      timestamp: isoMinutesAgo(14),
      channel: "web",
    })
  );
  insertScored(
    makeBaseTransaction(marcus, MERCHANTS.find((m) => m.name === "CryptoRush OTC"), {
      amount: 4820,
      timestamp: isoMinutesAgo(12),
      country: "EE",
      city: "Tallinn",
      device: "Windows VM · Chrome",
      channel: "web",
    })
  );

  insertScored(
    makeBaseTransaction(ananya, MERCHANTS.find((m) => m.name === "NightWire Transfers"), {
      amount: 18640,
      timestamp: isoMinutesAgo(9),
      country: "NG",
      city: "Lagos",
      device: "Unknown Android",
      channel: "web",
    })
  );

  insertScored(
    makeBaseTransaction(owen, MERCHANTS.find((m) => m.name === "LuckySpin Casino"), {
      amount: 3100,
      timestamp: isoMinutesAgo(4),
      country: "MT",
      city: "Valletta",
      device: "iPad · Safari",
      channel: "app",
    })
  );

  store.transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function generateLiveTransaction(forcePattern) {
  const user = pick(store.users);
  const localMerchants = MERCHANTS.filter((merchant) => merchant.country === user.homeCountry);
  const roll = forcePattern || (Math.random() < 0.18 ? "risk" : Math.random() < 0.22 ? "review" : "normal");

  if (roll === "review") {
    const odd = pick(MERCHANTS);
    return makeBaseTransaction(user, odd, {
      amount: Number((user.avgAmount * (2.2 + Math.random() * 1.8)).toFixed(2)),
      timestamp: new Date().toISOString(),
      device: pick([user.primaryDevice, "iPad · Safari"]),
      channel: pick(["app", "web"]),
      country: odd.country,
      city: odd.city,
    });
  }

  if (roll === "risk") {
    const risky = pick(MERCHANTS.filter((merchant) => merchant.country !== user.homeCountry || merchant.category === "Crypto" || merchant.category === "Gambling"));
    return makeBaseTransaction(user, risky, {
      amount: Number((user.avgAmount * (4 + Math.random() * 10)).toFixed(2)),
      timestamp: new Date().toISOString(),
      device: pick(["Windows VM · Chrome", "Unknown Android", "rooted Pixel", user.primaryDevice]),
      channel: "web",
      country: risky.country,
      city: risky.city,
    });
  }

  return makeBaseTransaction(user, pick(localMerchants.length ? localMerchants : MERCHANTS), {
    timestamp: new Date().toISOString(),
    amount: Number((user.avgAmount * (0.25 + Math.random() * 1.15)).toFixed(2)),
  });
}

module.exports = { seed, insertScored, generateLiveTransaction, USERS, MERCHANTS, randomId };
