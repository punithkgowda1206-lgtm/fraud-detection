const store = {
  users: [],
  transactions: [],
  nextTxnId: 1,
  simulator: {
    running: true,
    intervalMs: 2200,
  },
};

module.exports = { store };
