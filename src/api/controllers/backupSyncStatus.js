const pool = require("../../../config/configuration");

const backupSyncStatus = async (req, res) => {
  const { salesforce_org_id } = req.body;
  try {
    const connection = await pool.getConnection();
    const [pendingJobs] = await connection.query(
      'SELECT dj.id, dj.job_name, dj.description, dj.job_type, dj.start_time, dj.end_time, dj.status, dj.total_objects, dj.total_records, dj.total_bytes FROM data_transfer_jobs dj JOIN org_drive_mappings m ON dj.mapping_id = m.id JOIN salesforce_orgs s ON m.org_id = s.id WHERE dj.status = "IN_PROGRESS" AND s.org_id = ?',
      [salesforce_org_id] 
    );

    let logs = []; 
    if (pendingJobs.length > 0) {
      const jobIds = pendingJobs.map((job) => job.id);

      const [pendingObjectJobs] = await connection.query(
        "SELECT dol.id, dol.data_transfer_job_id, dol.object_name, dol.fields_count, dol.estimated_size, dol.status, dol.folderId, dol.created_at, dol.updated_at FROM data_transfer_object_log dol JOIN data_transfer_jobs dj ON dol.data_transfer_job_id = dj.id WHERE dol.data_transfer_job_id IN (?)",
        [jobIds]
      );
      logs = pendingObjectJobs;
    }
 
    const [completedOrFailedJobs] = await connection.query(
      'SELECT dj.id, dj.job_name, dj.description, dj.job_type, dj.start_time, dj.end_time, dj.status, dj.total_objects, dj.total_records, dj.total_bytes FROM data_transfer_jobs dj JOIN org_drive_mappings m ON dj.mapping_id = m.id JOIN salesforce_orgs s ON m.org_id = s.id WHERE dj.status IN ("COMPLETED", "FAILED", "SUCCESS") AND s.org_id = ?  AND end_time >= NOW() - INTERVAL 1 DAY ORDER BY end_time', [salesforce_org_id]
    ); 

    const updatedJobs = [...pendingJobs, ...completedOrFailedJobs];

    res.json({
      message: "Backup sync status fetched successfully",
      data: {
        jobs: updatedJobs,
        logs: logs,
      },
    });
  } catch (error) {
    console.error("Error syncing backup status:", error);
    res
      .status(500)
      .json({ error: "Failed to sync backup status", details: error.message });
  }
};

module.exports = backupSyncStatus;
