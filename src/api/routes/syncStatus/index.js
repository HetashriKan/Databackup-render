const backupSyncStatus = require("../../controllers/backupSyncStatus");
const express = require("express");
const router = express.Router();

router.route("/").post(backupSyncStatus);

module.exports = router;

