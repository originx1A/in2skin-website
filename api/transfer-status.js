// GET /api/transfer-status — the voice agent's live check: may it transfer
// this call to Sarah right now? No sign-in needed: the answer is just
// yes/no plus a clock reading, no private data. On any error the agent
// takes a message instead of transferring.
const { getSettings, transferStatus } = require("../lib/transfer");

module.exports = async (req, res) => {
  try {
    const settings = await getSettings();
    return res.status(200).json(transferStatus(settings));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
