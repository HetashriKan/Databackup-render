const pool = require("../../../config/configuration");
const getOrgDetails = require("../../utils/getOrgDetails");
const jwt = require("jsonwebtoken");
const axios = require("axios");

async function getSalesforceAccessToken(orgDetails) {
  const {
    client_id,
    salesforce_api_username,
    salesforce_api_jwt_private_key,
    base_url,
  } = orgDetails[0][0];

  console.log("client_id", client_id);
  console.log("salesforce_api_username", salesforce_api_username);
  console.log("base_url", base_url);

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

  const response = await axios.post(tokenUrl, params);
  return response.data.access_token;
}

const syncBackupToSalesforce = async (req, res) => {
  const { salesforce_org_id } = req.body;
  if (!salesforce_org_id) {
    return res.status(400).json({ error: "salesforce_org_id is required" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [latestJob] = await connection.query(
      "SELECT * FROM data_transfer_jobs ORDER BY created_at DESC LIMIT 1"
    );

    if (latestJob.length === 0) {
      return res.status(404).json({ message: "No backup jobs found." });
    }

    const job = latestJob[0];

    const [objectLogs] = await connection.query(
      "SELECT * FROM data_transfer_object_log WHERE data_transfer_job_id = ?",
      [job.id]
    );

    console.log("objectLogs", objectLogs);

    const orgDetails = await connection.query(
      `SELECT o.id, o.org_id, o.client_id, o.salesforce_api_username, o.salesforce_api_jwt_private_key, o.base_url, o.instance_url,
       d.google_access_token, d.id, m.id AS drive_account_id FROM salesforce_orgs o
       JOIN org_drive_mappings m ON o.id = m.org_id
       JOIN drive_accounts d ON d.id = m.drive_account_id
       WHERE o.org_id = ? `,
      [salesforce_org_id]
    );

    console.log("orgDetails", orgDetails[0][0].instance_url);
    const accessToken = await getSalesforceAccessToken(orgDetails);
    console.log("Salesforce Access Token obtained:", accessToken);
    const backupObjects = {};
    const logsToSync = [];
    objectLogs.forEach((log) => {
      try {
        console.log("log @@", log);
        // The field list is now stored as a JSON string in the 'status' column.
        const fields = JSON.parse(log.fields_list);
        
        logsToSync.push({
            // Assuming you want to pass this structure for a complete log sync:
            mysql_log_id: log.id, 
            object_name: log.object_name,
            status: log.status, // Now contains 'COMPLETED' or 'FAILED'
            fields_count: fields.length,
            selected_fields: fields, 
            estimated_size: log.estimated_size,
            folderId: log.folderId
        });
      } catch (e) {
        console.error(`Failed to parse fields for ${log.object_name}:`, log.fields_list);
      }
    });

    
    
    const configMap = {
        backupName: job.job_name,
        backupDescription: job.description,
        backupId: job.id,
        backupStatus: job.status,
        backupTotalObjects: job.total_objects,
        backupTotalRecords: job.total_records,
        backupTotalBytes: job.total_bytes,
        backupStartTime: job.start_time,
        backupEndTime: job.end_time,
        backupFolderId: job.folderId,
        backupTotalProcessedRecords: job.total_record_processed,
        operationType: 'Backup',
        storageType: 'Google Drive', 
        backupType: 'Full',
        processingOrigin: 'EW server'
    };

    const salesforceEndpoint = `${orgDetails[0][0].instance_url}/services/apexrest/cloudBackup`; 
    console.log("salesforceEndpoint", salesforceEndpoint);
    console.log("logsToSync", logsToSync);
    console.log("configMap", configMap);
    await axios.post(
      salesforceEndpoint,
      {
        objectLogs: logsToSync,
        configMap: configMap,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    await connection.commit();
    res.json({
      message: "Backup job successfully synced to Salesforce.",
      jobId: job.id,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error syncing backup to Salesforce:", error);
    res
      .status(500)
      .json({
        error: "Failed to sync backup to Salesforce",
        details: error.message,
      });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = syncBackupToSalesforce;
