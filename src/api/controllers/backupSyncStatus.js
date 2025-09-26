const { pool } = require("../../../config/configuration");

const backupSyncStatus = async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [pendingJobs] = await connection.query(
      'SELECT id, job_name, description, job_type, start_time, end_time, status, total_objects, total_records, total_bytes FROM data_transfer_job WHERE status = "IN_PROGRESS"'
    );

    let logs = [];
    if (pendingJobs.length > 0) {
      const jobIds = pendingJobs.map((job) => job.id);

      const [pendingObjectJobs] = await connection.query(
        "SELECT id, data_transer_job_id, object_name, fields_count, estimated_size, status, folderId, created_at, updated_at FROM data_transfer_object_log WHERE data_transer_job_id IN (?)",
        [jobIds]
      );
      logs = pendingObjectJobs;
    }

    const [completedOrFailedJobs] = await connection.query(
      'SELECT id, job_name, description, job_type, start_time, end_time, status, total_objects, total_records, total_bytes FROM data_transfer_job WHERE status IN ("COMPLETED", "FAILED", "SUCCESS") AND end_time >= NOW() - INTERVAL 1 DAY ORDER BY end_time'
    );

    const updatedJobs = [...pendingJobs, ...completedOrFailedJobs];

    res.status.json({
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
