const fs = require("fs");
const { parse } = require("fast-csv");
const { Connection } = require("jsforce");
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const csv = require("fast-csv");
const path = require("path");
const { fileURLToPath } = require("url");
const { parseString } = require("fast-csv");
const { GoogleAuth } = require("google-auth-library");
const pool = require("../../../config/configuration");
const { file } = require("googleapis/build/src/apis/file");
const skippedFields = require("../../../skipField");
const { Transform } = require("stream");
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// import key from "../../../server.key" assert { type: "json" };

// const CLIENT_ID =
//   "3MVG9rZjd7MXFdLgHai.mMLjdZInoptkBi0b16FFO0v3YeJeiIvYMWk7u5spFpNflYxp2F7ryYpRhcbVbY5EP";
// async function uploadToGoogleDrive(filePath, fileName, accessToken, folderId) {
//   const oAuth2Client = new google.auth.OAuth2();
//   oAuth2Client.setCredentials({ access_token: accessToken });
//   const drive = google.drive({ version: "v3", auth: oAuth2Client });

//   const fileMetadata = {
//     name: fileName,
//     parents: [folderId],
//   };
//   const media = {
//     mimeType: "application/json",
//     body: fs.createReadStream(filePath),
//   };

//   const response = await drive.files.create({
//     resource: fileMetadata,
//     media,
//     fields: "id",
//   });

//   return response.data.id;
// }

const createFolderInGoogleDrive = async (
  folderName,
  parentFolderId = null,
  ACCESS_TOKEN
) => {
  const oAuth2Client = new google.auth.OAuth2();
  oAuth2Client.setCredentials({ access_token: ACCESS_TOKEN });
  const drive = google.drive({ version: "v3", auth: oAuth2Client });

  // console.log("drive " + JSON.stringify(drive));
  try {
    // 1. Search for the folder
    let query = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${folderName}'`;
    if (parentFolderId) {
      query += ` and '${parentFolderId}' in parents`;
    }

    // console.log("querrrry " + query);
    const res = await drive.files
      .list({
        q: query,
        fields: "files(id, name)",
      })
      .catch((error) => {
        console.error("Google Drive API files.list error:", error);
        throw error;
      });

    // console.log("res " + JSON.stringify(res));
    const folders = res.data.files;

    if (folders.length > 0) {
      console.log(
        `Folder '${folderName}' already exists. ID: ${folders[0].id}`
      );
      return folders[0].id;
    } else {
      const fileMetadata = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
      };
      if (parentFolderId) {
        fileMetadata.parents = [parentFolderId];
      }

      const newFolder = await drive.files.create({
        resource: fileMetadata,
        fields: "id",
      });

      console.log(`Folder '${folderName}' created. ID: ${newFolder.data.id}`);
      return newFolder.data.id;
    }
  } catch (error) {
    console.error("Error in getOrCreateFolder:", error);
    throw error;
  }
};

async function uploadToGoogleDriveWithAccessToken(
  filePath,
  fileName,
  folderId,
  ACCESS_TOKEN
) {
  console.log("innnnn");
  const oAuth2Client = new google.auth.OAuth2();
  oAuth2Client.setCredentials({ access_token: ACCESS_TOKEN });
  const drive = google.drive({ version: "v3", auth: oAuth2Client });
  // const folderId = await createFolderInGoogleDrive(
  //   folderName,
  //   null,
  //   ACCESS_TOKEN
  // );
  console.log("Folder Id:", folderId);
  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };
  const media = {
    mimeType: "text/csv",
    body: fs.createReadStream(filePath),
  };
  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: "id",
    uploadType: "resumable",
  });

  console.log("drive id " + response.data.id);
  // fs.unlinkSync(filePath);

  return response.data.id;
}

const backupController = async (req, res) => {
  const { salesforce_org_id, backupName, backupData } = req.body;
  if (!salesforce_org_id || !backupName || !backupData) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  const connection = await pool.getConnection();
  let dataJobId;
  try {
    console.time("🔑 Fetch Org Details");
    const [orgDetails] = await connection.query(
      `SELECT o.org_id, o.client_id, o.salesforce_api_username, o.salesforce_api_jwt_private_key, o.base_url, o.instance_url,
       d.google_access_token, d.id, m.id AS drive_account_id FROM salesforce_orgs o
       JOIN org_drive_mappings m ON o.id = m.org_id
       JOIN drive_accounts d ON d.id = m.drive_account_id
       WHERE o.org_id = ? `,
      [salesforce_org_id]
    );
    console.timeEnd("🔑 Fetch Org Details");

    if (!orgDetails || orgDetails.length === 0) {
      return res.status(404).json({ error: "Org mapping not found" });
    }

    const org = orgDetails[0];
    // console.log("org details " + JSON.stringify(org));

    // Salesforce JWT Auth
    console.time("🔐 Salesforce Auth");
    const claim = {
      iss: org.client_id,
      sub: org.salesforce_api_username,
      aud: org.base_url,
      exp: Math.floor(Date.now() / 1000) + 3 * 60,
    };
    const signedJWT = jwt.sign(claim, org.salesforce_api_jwt_private_key, {
      algorithm: "RS256",
    });

    const conn = new Connection({ loginUrl: org.base_url, maxFetch: 500 });
    await conn.authorize({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJWT,
    });
    console.timeEnd("🔐 Salesforce Auth");

    const summary = { totalObjects: 0, totalRecords: 0 };
    const tempDir = path.join(__dirname, "../../../temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const ACCESS_TOKEN = org.google_access_token;

    console.time("📂 Create Root & Backup Folders");
    const rootFolderId = await createFolderInGoogleDrive(
      `EW_DB_${salesforce_org_id}`,
      null,
      ACCESS_TOKEN
    );
    const backupNameFolderId = await createFolderInGoogleDrive(
      backupName,
      rootFolderId,
      ACCESS_TOKEN
    );
    console.timeEnd("📂 Create Root & Backup Folders");

    console.time("📝 Insert Job Record");
    const [result] = await connection.query(
      `INSERT INTO data_transfer_job (mapping_id, job_name, description, job_type, start_time, status, total_objects, folderId, created_at, updated_at)
       SELECT m.id, ?, ?, ?, NOW(), ?, ?, ?, NOW(), NOW()
       FROM salesforce_orgs o
       JOIN org_drive_mappings m ON o.id = m.org_id
       JOIN drive_accounts d ON d.id = m.drive_account_id
       WHERE o.org_id = ?`,
      [
        backupName,
        "Automated backup job",
        "BACKUP",
        "IN_PROGRESS",
        Object.keys(backupData).length,
        backupNameFolderId,
        org.org_id,
      ]
    );
    console.timeEnd("📝 Insert Job Record");

    dataJobId = result.insertId;
    let totalBytes = 0;

    // Loop through each object
    for (let [objectName, soql] of Object.entries(backupData)) {
      console.log(`\n=== 🚀 Processing ${objectName} ===`);
      const stepStart = Date.now();

      console.time(`📂 Create Folder for ${objectName}`);
      const objectNameFolderId = await createFolderInGoogleDrive(
        objectName,
        backupNameFolderId,
        ACCESS_TOKEN
      );
      console.timeEnd(`📂 Create Folder for ${objectName}`);

      // Adjust SOQL for skipped fields
      if (skippedFields[objectName] && skippedFields[objectName].field) {
        const fieldsToSkip = skippedFields[objectName].field;
        const selectIndex = soql.toUpperCase().indexOf("SELECT") + 6;
        const fromIndex = soql.toUpperCase().indexOf("FROM");
        const fieldsPart = soql.substring(selectIndex, fromIndex).trim();
        const fieldsArray = fieldsPart.split(",").map((f) => f.trim());
        const filteredFields = fieldsArray.filter(
          (f) => !fieldsToSkip.includes(f)
        );
        const newFieldsPart = filteredFields.join(", ");
        soql =
          soql.substring(0, selectIndex) +
          " " +
          newFieldsPart +
          " " +
          soql.substring(fromIndex);
      }

      console.time(`🔎 Query and CSV Generation for ${objectName}`);
      const fileName = `${objectName}.csv`;
      const filePath = path.join(tempDir, fileName);
      const writeStream = fs.createWriteStream(filePath);
      const csvStream = csv.format({ headers: true });

      let recordCount = 0;
      const countAndTransform = new Transform({
        objectMode: true,
        transform(record, encoding, callback) {
          recordCount++;
          const { attributes, ...rest } = record;
          this.push(rest);
          callback();
        },
      });

      const sfQueryStream = conn.query(soql);

      await new Promise((resolve, reject) => {
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
        sfQueryStream
          .on("error", reject)
          .pipe(countAndTransform)
          .on("error", reject)
          .pipe(csvStream)
          .on("error", reject)
          .pipe(writeStream);
      });
      console.timeEnd(`🔎 Query and CSV Generation for ${objectName}`);

      summary.totalObjects++;
      summary.totalRecords += recordCount;

      let objectFileSize = 0;

      if (recordCount > 0) {
        objectFileSize = fs.statSync(filePath).size;

        console.time(`☁️ Upload ${objectName} to Drive`);
        await uploadToGoogleDriveWithAccessToken(
          filePath,
          fileName,
          objectNameFolderId,
          ACCESS_TOKEN
        );
        console.timeEnd(`☁️ Upload ${objectName} to Drive`);

        fs.unlinkSync(filePath);
      }

      console.time(`📝 Insert Log for ${objectName}`);
      const fields = soql
        .match(/SELECT (.*) FROM/i)[1]
        .split(",")
        .map((f) => f.trim());
      await connection.query(
        `INSERT INTO data_transfer_object_log (data_transfer_job_id, object_name, fields_count, estimated_size, status, folderId, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          dataJobId,
          objectName,
          fields.length,
          objectFileSize,
          "Completed",
          objectNameFolderId,
        ]
      );
      console.timeEnd(`📝 Insert Log for ${objectName}`);

      totalBytes += objectFileSize;

      console.log(
        `⏱️ Total time for ${objectName}: ${(Date.now() - stepStart) / 1000}s`
      );
    }

    console.time("✅ Finalize Job");
    await connection.query(
      `UPDATE data_transfer_job SET end_time = NOW(), status = 'Completed', total_records = ?, total_bytes = ?, updated_at = NOW()WHERE id = ?`,
      [summary.totalRecords, totalBytes, dataJobId]
    );
    console.timeEnd("✅ Finalize Job");

    return res.status(200).json({
      message: "Backup completed successfully",
      summary,
    });
  } catch (error) {
    console.error("Backup error:", error);
    if (dataJobId) {
      await connection.query(
        `UPDATE data_transfer_job SET end_time = NOW(), status = 'FAILED', updated_at = NOW() WHERE id = ?`,
        [dataJobId]
      );
    }
    return res
      .status(500)
      .json({ error: "Backup failed", details: error.message });
  } finally {
    connection.release();
  }
};

module.exports = {
  backupController,
};
