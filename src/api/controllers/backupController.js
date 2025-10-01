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
const axios = require("axios");
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
        fields: "files(id, name, capabilities)",
      })
      .catch((error) => {
        console.error("Google Drive API files.list error:", error);
        throw error;
      });

    // console.log("res " + JSON.stringify(res));
    const folders = res.data.files;

    if (folders.length > 0) {
      const folder = folders[0];
      console.log(`Folder '${folderName}' already exists. ID: ${folder.id}`);
      if (folder.capabilities && folder.capabilities.canAddChildren === false) {
        throw new Error(
          `Insufficient permissions for folder '${folderName}'. Cannot add files or folders to it.`
        );
      }
      return folder.id;
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

const syncJobToSalesforce = async (job, orgDetails, connection) => {
  // Re-use the JWT auth logic from getSalesforceAccessToken, but simplify for direct use
  const org = orgDetails[0];
  const {
    client_id,
    salesforce_api_username,
    salesforce_api_jwt_private_key,
    base_url,
  } = org;

  const jwtPayload = {
    iss: client_id,
    sub: salesforce_api_username,
    aud: base_url,
    exp: Math.floor(Date.now() / 1000) + 60 * 3,
  };

  const token = jwt.sign(jwtPayload, salesforce_api_jwt_private_key, {
    algorithm: "RS256",
  });

  const tokenUrl = `${base_url}/services/oauth2/token`;
  const params = new URLSearchParams();
  params.append("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  params.append("assertion", token);
  const accessTokenResponse = await axios.post(tokenUrl, params);
  const accessToken = accessTokenResponse.data.access_token;

  const configMap = {
    backupName: job.job_name,
    backupDescription: job.description,
    backupId: job.id, // MySQL Job ID -> Salesforce External_ID__c
    backupStatus: job.status,
    backupTotalObjects: job.total_objects,
    backupTotalRecords: job.total_records,
    backupTotalBytes: job.total_bytes,
    backupStartTime: job.start_time,
    backupEndTime: job.end_time,
    backupFolderId: job.folderId,
    operationType: "Backup",
    storageType: "Google Drive",
    backupType: "Full",
    processingOrigin: "EW server",
  };

  // For the initial sync, backupObjects will be an empty map or contain only object names
  // For the final sync, it will contain the field lists
  const [objectLogs] = await connection.query(
    "SELECT id, object_name, status, estimated_size, folderId FROM data_transfer_object_log WHERE data_transfer_job_id = ?",
    [job.id]
  );
  const logsToSync = [];

  // Process logs only on final status where data is complete
  if (job.status === "Completed" || job.status === "FAILED") {
    objectLogs.forEach((log) => {
      try {
        const fields = JSON.parse(log.status);
        logsToSync.push({
          // MySQL Log ID will be the External ID for the Salesforce Log record
          mysql_log_id: log.id,
          object_name: log.object_name,
          fields_count: fields.length,
          selected_fields: fields, // Send the array of field names
          estimated_size: log.estimated_size,
          folderId: log.folderId,
        });
      } catch (e) {
        console.error(
          `Failed to parse fields for ${log.object_name} (Log ID: ${log.id}):`,
          log.status
        );
      }
    });
  }

  const salesforceEndpoint = `${org.instance_url}/services/apexrest/cloudBackup`;

  console.log(
    `Syncing job ${job.id} with status ${job.status} to Salesforce...`
  );

  const response = await axios.post(
    salesforceEndpoint,
    {
      configMap: configMap,
      // Pass the detailed logs array
      objectLogs: logsToSync,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  return response.data;
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
  let salesforceJobId = null;
  const summary = { totalObjects: 0, totalRecords: 0 };
  let totalBytes = 0;
  let failedBackupNameFolderId;
  let orgDetails;

  try {
    console.time("🔑 Fetch Org Details");
    [orgDetails] = await connection.query(
      `SELECT o.id, o.org_id, o.client_id, o.salesforce_api_username, o.salesforce_api_jwt_private_key, o.base_url, o.instance_url,
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

    console.log("signed JWT " + signedJWT);
    const conn = new Connection({ loginUrl: org.base_url, maxFetch: 500 });
    await conn.authorize({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJWT,
    });
    console.timeEnd("🔐 Salesforce Auth");

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

    await connection.query(
      `UPDATE drive_accounts d JOIN org_drive_mappings m ON d.id = m.drive_account_id SET d.default_root_folder = ? WHERE m.org_id = ?`,
      [rootFolderId, orgDetails.id]
    );

    const backupNameFolderId = await createFolderInGoogleDrive(
      backupName,
      rootFolderId,
      ACCESS_TOKEN
    );
    failedBackupNameFolderId = backupNameFolderId;
    console.timeEnd("📂 Create Root & Backup Folders");

    console.time("📝 Insert Job Record");
    const [result] = await connection.query(
      `INSERT INTO data_transfer_jobs (mapping_id, job_name, description, job_type, start_time, status, total_objects, folderId, created_at, updated_at)
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

    const initialJob = {
      id: dataJobId,
      job_name: backupName,
      description: "Automated backup job",
      status: "IN_PROGRESS",
      total_objects: Object.keys(backupData).length,
      folderId: backupNameFolderId,
      total_records: 0,
      total_bytes: 0,
      start_time: new Date(),
      end_time: null, // Placeholder values
    };

    console.time("🔄 Initial Sync to Salesforce (IN_PROGRESS)");
    const syncResult = await syncJobToSalesforce(
      initialJob,
      orgDetails,
      connection
    );
    salesforceJobId = syncResult.jobId;
    console.log(`Salesforce Job ID: ${salesforceJobId}`);

    await connection.query(
      `UPDATE data_transfer_jobs SET salesforce_job_id = ? WHERE id = ?`,
      [salesforceJobId, dataJobId]
    );
    console.timeEnd("🔄 Initial Sync to Salesforce (IN_PROGRESS)");

    const MAX_FILE_SIZE = 250 * 1024 * 1024;

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

      // console.time(`🔎 Query and CSV Generation for ${objectName}`);
      // const fileName = `${objectName}.csv`;
      // const filePath = path.join(tempDir, fileName);
      // const writeStream = fs.createWriteStream(filePath);
      // var stats = fs.statSync(filePath);
      // var fileSizeInBytes = stats.size;
      // console.log('file sieze ' + fileSizeInBytes)
      // const csvStream = csv.format({ headers: true });

      // let recordCount = 0;
      // const countAndTransform = new Transform({
      //   objectMode: true,
      //   transform(record, encoding, callback) {
      //     recordCount++;
      //     const { attributes, ...rest } = record;
      //     this.push(rest);
      //     callback();
      //   },
      // });

      // const sfQueryStream = conn.query(soql);

      // await new Promise((resolve, reject) => {
      //   writeStream.on("finish", resolve);
      //   writeStream.on("error", reject);
      //   sfQueryStream
      //     .on("error", reject)
      //     .pipe(countAndTransform)
      //     .on("error", reject)
      //     .pipe(csvStream)
      //     .on("error", reject)
      //     .pipe(writeStream);
      // });
      // console.timeEnd(`🔎 Query and CSV Generation for ${objectName}`);

      // summary.totalObjects++;
      // summary.totalRecords += recordCount;

      // let objectFileSize = 0;

      // if (recordCount > 0) {
      //   objectFileSize = fs.statSync(filePath).size;

      //   console.time(`☁️ Upload ${objectName} to Drive`);
      //   await uploadToGoogleDriveWithAccessToken(
      //     filePath,
      //     fileName,
      //     objectNameFolderId,
      //     ACCESS_TOKEN
      //   );
      //   console.timeEnd(`☁️ Upload ${objectName} to Drive`);

      //   fs.unlinkSync(filePath);
      // }

      let allRecords = [];
      let queryResult = await conn.query(soql);
      allRecords = allRecords.concat(queryResult.records);

      while (!queryResult.done) {
        queryResult = await conn.queryMore(queryResult.nextRecordsUrl);
        allRecords = allRecords.concat(queryResult.records);
      }

      summary.totalObjects++;
      summary.totalRecords += allRecords.length;

      let objectFileSize = 0;
      let recordsInObject = allRecords.length;

      if (recordsInObject > 0) {
        console.time(`🔎 CSV Generation and Upload for ${objectName}`);
        let filePart = 1;
        let currentFilePath;
        let currentWriteStream;
        let currentCsvStream;
        let recordsInCurrentFile = 0;
        let fileSizeTracker = 0;
        let fileOpenPromise = Promise.resolve();

        const createNewFile = () => {
          const fileName = `${objectName}_${filePart}.csv`;
          currentFilePath = path.join(tempDir, fileName);
          currentWriteStream = fs.createWriteStream(currentFilePath); // Using the original `csv.format` since the streaming logic was replaced with `conn.query` and manual pagination.
          currentCsvStream = csv.format({ headers: true });
          currentCsvStream.pipe(currentWriteStream);
          recordsInCurrentFile = 0;
          fileSizeTracker = 0; // Reset size tracker for the new file
        };
        const closeAndUploadFile = async () => {
          if (recordsInCurrentFile > 0) {
            await new Promise((resolve, reject) => {
              currentCsvStream.end();
              currentWriteStream.on("finish", resolve);
              currentWriteStream.on("error", reject);
            });

            const currentFileSize = fs.statSync(currentFilePath).size;
            objectFileSize += currentFileSize;
            totalBytes += currentFileSize;

            console.log(
              `☁️ Uploading ${path.basename(currentFilePath)} (${(
                currentFileSize /
                (1024 * 1024)
              ).toFixed(2)} MB)`
            );
            await uploadToGoogleDriveWithAccessToken(
              currentFilePath,
              path.basename(currentFilePath),
              objectNameFolderId,
              ACCESS_TOKEN
            );
            fs.unlinkSync(currentFilePath);
          }
        };

        createNewFile();

        for (const record of allRecords) {
          const { attributes, ...rest } = record; // Estimate row size for file splitting logic
          const headerlessRow = Object.values(rest).join(",");
          const rowString =
            recordsInCurrentFile === 0
              ? Object.keys(rest).join(",") + "\n" + headerlessRow + "\n"
              : headerlessRow + "\n";
          const rowSize = Buffer.byteLength(rowString, "utf8");

          if (fileSizeTracker + rowSize > MAX_FILE_SIZE) {
            // Close and upload the current file
            await closeAndUploadFile(); // Start a new file

            filePart++;
            createNewFile(); // Recalculate size for the new file to include headers
            const newFileHeaderRow = Object.keys(rest).join(",") + "\n";
            const newFileHeaderSize = Buffer.byteLength(
              newFileHeaderRow,
              "utf8"
            );
            fileSizeTracker += newFileHeaderSize;
          }

          currentCsvStream.write(rest);
          if (recordsInCurrentFile === 0) {
            // On first record, account for both data and header size
            const headerRow = Object.keys(rest).join(",") + "\n";
            fileSizeTracker += Buffer.byteLength(headerRow, "utf8");
            fileSizeTracker += Buffer.byteLength(headerlessRow + "\n", "utf8");
          } else {
            fileSizeTracker += Buffer.byteLength(headerlessRow + "\n", "utf8");
          }

          recordsInCurrentFile++;
        } // Final close and upload for the last file part

        await closeAndUploadFile();
        console.timeEnd(`🔎 CSV Generation and Upload for ${objectName}`);
      }

      console.time(`📝 Insert Log for ${objectName}`);
      const fields = soql
        .match(/SELECT (.*) FROM/i)[1]
        .split(",")
        .map((f) => f.trim());

      // Set the proper log status (since the job is completed for this object)
      const objectLogStatus = "COMPLETED";

      await connection.query(
        `INSERT INTO data_transfer_object_log (data_transfer_job_id, object_name, fields_count, estimated_size, status, fields_list, folderId, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`, // <-- Cleaned up: Removed leading tabs/spaces
        [
          dataJobId,
          objectName,
          fields.length,
          objectFileSize,
          objectLogStatus,
          JSON.stringify(fields),
          objectNameFolderId,
        ]
      );

      totalBytes += objectFileSize;

      console.log(
        `⏱️ Total time for ${objectName}: ${(Date.now() - stepStart) / 1000}s`
      );
    }

    console.time("✅ Finalize Job");
    console.log("Summary:", JSON.stringify(summary));
    await connection.query(
      `UPDATE data_transfer_jobs SET end_time = NOW(), status = 'Completed', total_records = ?, total_bytes = ? WHERE id = ?`,
      [summary.totalRecords, totalBytes, dataJobId]
    );

    const finalJob = {
      id: dataJobId,
      job_name: backupName,
      description: "Automated backup job",
      status: "Completed", // Final status
      total_objects: summary.totalObjects,
      total_records: summary.totalRecords,
      total_bytes: totalBytes,
      start_time: initialJob.start_time, // Use start time from initial job or fetch from DB
      end_time: new Date(),
      folderId: backupNameFolderId,
      salesforce_job_id: salesforceJobId, // Pass SF ID for completeness
    };

    console.time("🔄 Final Sync to Salesforce (Completed)");
    await syncJobToSalesforce(finalJob, orgDetails, connection);
    console.timeEnd("🔄 Final Sync to Salesforce (Completed)");
    console.timeEnd("✅ Finalize Job");

    return res.status(200).json({
      message: "Backup completed successfully",
      summary,
    });
  } catch (error) {
    // --- Stage 4 (Error): Finalize MySQL Job (FAILED) & Sync ---
    await connection.rollback();
    console.error("Backup error:", error);

    if (dataJobId) {
      // Update MySQL to FAILED
      const failJobQuery = `UPDATE data_transfer_jobs SET end_time = NOW(), status = 'FAILED' WHERE id = ?`;
      await connection.query(failJobQuery, [dataJobId]);

      // Sync FAILED status to Salesforce
      if (salesforceJobId) {
        try {
          const failedJob = {
            id: dataJobId,
            job_name: backupName || "Unknown", // Need to ensure backupName is available in scope
            description: "Automated backup job",
            status: "FAILED",
            total_objects: summary ? summary.totalObjects : 0, // Use available summary
            total_records: summary ? summary.totalRecords : 0,
            total_bytes: totalBytes || 0,
            start_time: new Date(),
            end_time: new Date(),
            folderId: failedBackupNameFolderId, // Need to ensure folderId is available in scope
            salesforce_job_id: salesforceJobId,
          };
          await syncJobToSalesforce(failedJob, orgDetails, connection);
          console.log("Failed status successfully synced to Salesforce.");
        } catch (syncError) {
          console.error(
            "Critical error: Failed to sync FAILED status to Salesforce:",
            syncError
          );
        }
      }
    }

    return res.status(500).json({
      error: "Backup failed",
      details: error.message,
    });
  } finally {
    connection.release();
  }
};

module.exports = {
  backupController,
};
