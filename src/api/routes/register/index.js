
const express = require('express');
const router = express.Router();
const { generateCertificate } = require('../../controllers/registerController');

router.post('/', generateCertificate);

module.exports = router;
