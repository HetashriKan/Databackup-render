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

    console.log("querrrry " + query);
    const res = await drive.files
      .list({
        q: query,
        fields: "files(id, name)",
      })
      .catch((error) => {
        console.error("Google Drive API files.list error:", error);
        throw error; 
      });

    console.log("res " + JSON.stringify(res));
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
  try {
    //  Get Org + Drive details with joins
    const [orgDetails] = await connection.query(
      `SELECT o.org_id, o.client_id, o.salesforce_api_username, o.salesforce_api_jwt_private_key, o.base_url, o.instance_url,
              d.google_access_token
       FROM salesforce_orgs o
       JOIN drive_accounts d ON o.org_id = d.salesforce_org_id
       WHERE o.org_id = ? LIMIT 1`,
      [salesforce_org_id]
    );

    if (!orgDetails || orgDetails.length === 0) {
      return res.status(404).json({ error: "Org mapping not found" });
    }

    const org = orgDetails[0];
    console.log("org details " + JSON.stringify(org));

    // Salesforce JWT Auth
    const claim = {
      iss: org.client_id,
      sub: org.salesforce_api_username,
      aud: org.base_url,
      exp: Math.floor(Date.now() / 1000) + 3 * 60,
    };
    const signedJWT = jwt.sign(claim, org.salesforce_api_jwt_private_key, {
      algorithm: "RS256",
    });

    const conn = new Connection({ loginUrl: org.base_url  });
    await conn.authorize({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJWT,
    });

    // Run SOQL, create CSV for each object, and upload
    const driveFileIds = {};
    const summary = {
      totalObjects: 0,
      totalRecords: 0,
    };
    const tempDir = path.join(__dirname, "../../../temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const ACCESS_TOKEN = org.google_access_token;

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

    let fileSize = 0;

    for (const [objectName, soql] of Object.entries(backupData)) {
      const objectNameFolderId = await createFolderInGoogleDrive(
        objectName,
        backupNameFolderId,
        ACCESS_TOKEN
      );

      const queryResult = await conn.query(soql);
      // console.log("queryResult " + JSON.stringify(queryResult));
      // console.log("queryResult records" + JSON.stringify(queryResult.records));
      summary.totalObjects++;
      summary.totalRecords += queryResult.totalSize;

      if (queryResult.records && queryResult.records.length > 0) {
        let filePart = 1;
        let currentFilePath;
        let currentWriteStream;
        let currentCsvStream;
        let recordsInCurrentFile = 0;

        const createNewFile = () => {
          const fileName = `${objectName}_${filePart}.csv`;
          currentFilePath = path.join(tempDir, fileName);
          currentWriteStream = fs.createWriteStream(currentFilePath);
          currentCsvStream = csv.format({ headers: true });
          currentCsvStream.pipe(currentWriteStream);
          recordsInCurrentFile = 0;
        };

        createNewFile();

        const MAX_FILE_SIZE = 20 * 1024 * 1024; 
        let fileSizeTracker = 0;

        for (const record of queryResult.records) {
          const { attributes, ...rest } = record;

          // Convert row to CSV string to measure exact bytes
          const rowString = Object.values(rest).join(",") + "\n";
          const rowSize = Buffer.byteLength(rowString);

          // Check if adding this row would exceed the limit - if yes then close the file and upload
          if (fileSizeTracker + rowSize > MAX_FILE_SIZE) {
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
              objectNameFolderId,
              ACCESS_TOKEN
            );
            driveFileIds[`${objectName}_${filePart}`] = driveFileId;
            fs.unlinkSync(currentFilePath);

            // Create new file
            filePart++;
            createNewFile();
            fileSizeTracker = 0;
          }

          currentCsvStream.write(rest);
          fileSizeTracker += rowSize;
          recordsInCurrentFile++;   
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
            objectNameFolderId,
            ACCESS_TOKEN
          );
          driveFileIds[`${objectName}_${filePart}`] = driveFileId;
          fs.unlinkSync(currentFilePath);
        }
      }
    }

    //Step 6: Insert job metadata in data_jobs

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
        summary.totalRecords,
        fileSize,
      ]
    );

    // console.log("org id " + org.org_id);
    // console.log("drive account id " + org.drive_id);
    // console.log("target folder id " + org.target_folder_id);
    // await connection.query(
    //   `INSERT INTO org_drive_mappings (org_id, drive_account_id, target_folder_id)
    //        VALUES (?, ?, ?)`,
    //   [
    //     org.org_id,
    //     org.drive_account_id,
    //     org.target_folder_id,
    //   ]
    // );

    return res.status(200).json({
      message: "Backup completed successfully",
      driveFileIds,
      summary,
    });
  } catch (error) {
    console.error("Backup error:", error);
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
