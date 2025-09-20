const fs = require("fs");
const path = require("path");
const { Connection } = require("jsforce");
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const pool = require("../../../config/configuration");
const getOrgDetails = require("../../utils/getOrgDetails");

// Google Drive uploader helper
async function uploadToGoogleDrive(filePath, fileName, accessToken, folderId) {
  const oAuth2Client = new google.auth.OAuth2();
  oAuth2Client.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: "v3", auth: oAuth2Client });

  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };
  const media = {
    mimeType: "application/json",
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media,
    fields: "id",
  });

  return response.data.id;
}

const backupController = async (req, res) => {
  const { salesforce_org_id, backupName, backupData } = req.body;
  if (!salesforce_org_id || !backupName || !backupData) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  const connection = await pool.getConnection();
  try {
    // 🔹 Step 1: Get Org + Drive details with joins
    const [orgDetails] = await connection.query(
      `SELECT o.org_id, o.client_id, o.salesforce_api_username, o.salesforce_api_jwt_private_key, o.base_url,
              d.id AS drive_account_id, d.google_access_token, m.target_folder_id
       FROM salesforce_orgs o
       JOIN org_drive_mappings m ON o.org_id = m.org_id
       JOIN drive_accounts d ON m.drive_account_id = d.id
       WHERE o.org_id = ? LIMIT 1`,
      [salesforce_org_id]
    );

    if (!orgDetails || orgDetails.length === 0) {
      return res.status(404).json({ error: "Org mapping not found" });
    }

    const org = orgDetails[0];

    // 🔹 Step 2: Salesforce JWT Auth
    const claim = {
      iss: org.client_id,
      sub: org.salesforce_api_username,
      aud: org.base_url,
      exp: Math.floor(Date.now() / 1000) + 3 * 60,
    };
    const signedJWT = jwt.sign(claim, org.salesforce_api_jwt_private_key, {
      algorithm: "RS256",
    });

    const conn = new Connection({ loginUrl: org.base_url });
    await conn.authorize({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJWT,
    });

    // 🔹 Step 3: Run SOQL queries from backupData
    const results = {};
    for (const [objectName, soql] of Object.entries(backupData)) {
      results[objectName] = await conn.query(soql);
    }

    // 🔹 Step 4: Save results to a JSON file
    const fileName = `backup_${salesforce_org_id}_${Date.now()}.json`;
    const filePath = path.join(__dirname, "../../../temp", fileName);
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(results, null, 2));

    // 🔹 Step 5: Upload JSON to Google Drive
    const driveFileId = await uploadToGoogleDrive(
      filePath,
      fileName,
      org.google_access_token,
      org.target_folder_id
    );

     for (const [objectName, soql] of Object.entries(backupData)) {
      const queryResult = await conn.query(soql);
      console.log('queryResult ' + JSON.stringify(queryResult));
      console.log('queryResult records' + JSON.stringify(queryResult.records));
      summary.totalObjects++;
      summary.totalRecords += queryResult.totalSize;

      if (queryResult.records && queryResult.records.length > 0) {
        let filePart = 1;
        let currentFilePath;
        let currentWriteStream;
        let currentCsvStream;
        let recordsInCurrentFile = 0;
        let isFirstFile = true;

        const createNewFile = () => {
          const fileName = `EWDB_${backupName}_${objectName}_${salesforce_org_id}_${Date.now()}_part_${filePart}.csv`;
          currentFilePath = path.join(tempDir, fileName);
          currentWriteStream = fs.createWriteStream(currentFilePath);
          // Write headers only for the first part of the backup for a given object
          currentCsvStream = csv.format({ headers: isFirstFile });
          if (isFirstFile) {
            isFirstFile = false;
          }
          currentCsvStream.pipe(currentWriteStream);
          recordsInCurrentFile = 0;
        };

        createNewFile();

        for (const record of queryResult.records) {
          const { attributes, ...rest } = record;
          currentCsvStream.write(rest);
          recordsInCurrentFile++;

          if (currentWriteStream.bytesWritten > MAX_FILE_SIZE) {
            await new Promise((resolve, reject) => {
              currentCsvStream.end();
              currentWriteStream.on("finish", resolve);
              currentWriteStream.on("error", reject);
            });

            const currentFileSize = fs.statSync(currentFilePath).size;
            fileSize += currentFileSize;

            const driveFileId = await uploadToGoogleDriveWithAccessToken(
              currentFilePath,
              path.basename(currentFilePath),
              backupName,
              ACCESS_TOKEN
            );
            driveFileId[`${objectName}_part_${filePart}`] = driveFileId;
            fs.unlinkSync(currentFilePath);

            filePart++;
            createNewFile();
          }
        }

        // End the last stream and upload the last file if it has content
        await new Promise((resolve, reject) => {
            currentCsvStream.end();
            currentWriteStream.on("finish", resolve);
            currentWriteStream.on("error", reject);
        });

        if (recordsInCurrentFile > 0) {
            const currentFileSize = fs.statSync(currentFilePath).size;
            fileSize += currentFileSize;

            const driveFileId = await uploadToGoogleDriveWithAccessToken(
                currentFilePath,
                path.basename(currentFilePath),
                backupName,
                ACCESS_TOKEN
            );
            driveFileIds[`${objectName}_part_${filePart}`] = driveFileId;
            fs.unlinkSync(currentFilePath);
        }
      }
    }

    // 🔹 Step 6: Insert job metadata in data_jobs
    await connection.query(
      `INSERT INTO data_jobs (org_id, drive_account_id, job_name, description, job_type, start_time, end_time, status, total_objects, total_records, total_bytes)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?)`,
      [
        org.org_id,
        org.drive_account_id,
        backupName,
        "Automated backup job",
        "BACKUP",
        "SUCCESS",
        Object.keys(backupData).length,
        Object.values(results).reduce((sum, obj) => sum + obj.totalSize, 0),
        fs.statSync(filePath).size,
      ]
    );

    fs.unlinkSync(filePath); // cleanup

    return res.status(200).json({
      message: "Backup completed successfully",
      driveFileId,
      summary: {
        totalObjects: Object.keys(results).length,
        totalRecords: Object.values(results).reduce(
          (sum, obj) => sum + obj.totalSize,
          0
        ),
      },
    });
  } catch (error) {
    console.error("Backup error:", error);
    return res.status(500).json({ error: "Backup failed", details: error.message });
  } finally {
    connection.release();
  }
};

module.exports = { backupController };
