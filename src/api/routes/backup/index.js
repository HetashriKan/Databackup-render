const express = require("express");
const router = express.Router();
const { backupController } = require("../../controllers/backupController");
router.route("/").post(backupController);

// app.post('/backup', async (req, res) => {
//   try {
//     const { orgId, accessToken, instanceUrl, objects } = req.body;

//     if (!orgId || !accessToken || !instanceUrl || !Array.isArray(objects)) {
//       return res.status(400).json({ error: 'Missing required parameters' });
//     }

//     // In real case, consider job queuing & rate limits
//     const objectBackupPromises = objects.map(async (objectName) => {
//       let allData = [];
//       let query = `SELECT+Id,+Name+FROM+${objectName}+LIMIT+2000`;
//       let url = `${instanceUrl}/services/data/v56.0/query?q=${query}`;

//       while (url) {
//         const response = await axios.get(url, {
//           headers: { Authorization: `Bearer ${accessToken}` },
//         });
//         allData = allData.concat(response.data.records);

//         url = response.data.nextRecordsUrl
//           ? `${instanceUrl}${response.data.nextRecordsUrl}`
//           : null;
//       }

//       // Process allData as needed (e.g., save to Google Drive...)
//       console.log(`Fetched ${allData.length} records from ${objectName} in org ${orgId}`);

//       return { objectName, recordsCount: allData.length };
//     });

//     const backupResults = await Promise.all(objectBackupPromises);

//     res.json({ orgId, backupResults, status: 'Backup completed' });
//   } catch (error) {
//     console.error('Backup error:', error.message);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// /api/backup/status	
// router.route("/status").get(async (req, res) => {
//   try {
//     res.status(200).json({
//       msg: "Hello World"
//     });
//   } catch (err) {
//     res.status(400).json({
//       msg: JSON.stringify(err),
//       data: [],
//     });
//   }
// });

// /api/backup/
// router.route("/").get(async (req, res) => {
//   try {
//     const { orgId, accessToken, instanceUrl, objects } = req.body;

//     if (!orgId || !accessToken || !instanceUrl || !Array.isArray(objects)) {
//       return res.status(400).json({ error: 'Missing required parameters' });
//     }

//     // In real case, consider job queuing & rate limits
//     const objectBackupPromises = objects.map(async (objectName) => {
//       let allData = [];
//       let query = `SELECT+Id,+Name+FROM+${objectName}+LIMIT+2000`;
//       let url = `${instanceUrl}/services/data/v56.0/query?q=${query}`;

//       while (url) {
//         const response = await axios.get(url, {
//           headers: { Authorization: `Bearer ${accessToken}` },
//         });
//         allData = allData.concat(response.data.records);

//         url = response.data.nextRecordsUrl
//           ? `${instanceUrl}${response.data.nextRecordsUrl}`
//           : null;
//       }

//       // Process allData as needed (e.g., save to Google Drive...)
//       console.log(`Fetched ${allData.length} records from ${objectName} in org ${orgId}`);

//       return { objectName, recordsCount: allData.length };
//     });

//     const backupResults = await Promise.all(objectBackupPromises);

//     res.json({ orgId, backupResults, status: 'Backup completed' });

//     res.status(200).json({
//       msg: "Hello World"
//     });
//   } catch (err) {
//     res.status(400).json({
//       msg: JSON.stringify(err),
//       data: [],
//     });
//   }
// });

module.exports = router;