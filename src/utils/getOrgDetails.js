const pool = require("../../config/configuration")

async function getOrgDetails(salesforceOrgId) {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      "SELECT client_id, salesforce_api_username, salesforce_api_jwt_private_key, access_token, base_url " +
      "FROM salesforce_orgs WHERE org_id = ? LIMIT 1",
      [salesforceOrgId]
    );
    if (rows.length === 0) {
      throw new Error("Salesforce Org not found");
    }
    return rows[0];
  } finally {
    connection.release();
  }
}

module.exports = getOrgDetails;