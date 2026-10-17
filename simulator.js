const { store } = require("./store");
const { insertScored, generateLiveTransaction } = require("./seed");

const listeners = new Set();
let timer = null;

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of listeners) {
    res.write(frame);
  }
}

function tick() {
  const txn = insertScored(generateLiveTransaction());
  store.transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  broadcast("transaction", txn);
}

function start() {
  if (timer) return store.simulator;
  store.simulator.running = true;
  timer = setInterval(tick, store.simulator.intervalMs);
  return store.simulator;
}

function stop() {
  store.simulator.running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  return store.simulator;
}

function subscribe(res) {
  listeners.add(res);
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  return () => listeners.delete(res);
}

module.exports = { start, stop, subscribe, broadcast, tick };
