const express = require("express");
const router = express.Router();
const refreshAccessTokenController = require("../../controllers/refreshAccessTokenController");

router.route("/").post(refreshAccessTokenController);

module.exports = router;

