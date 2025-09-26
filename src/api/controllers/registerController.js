const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const pool = require('../../../config/configuration');

const generateCertificate = async (req, res) => {
  const { name, companyName, email, city, state, username, clientId, baseUrl, org_id, instanceUrl } = req.body;

  if (!name || !companyName || !email || !city || !state || !username || !clientId || !baseUrl || !org_id || !instanceUrl) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const subj = `/C=US/ST=${state}/L=${city}/O=${companyName}/OU=IT/CN=${name}/emailAddress=${email}`;
  const keyPath = path.join(__dirname, 'server.key');
  const certPath = path.join(__dirname, 'server.crt');

  const opensslCmd = `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "${subj}"`;
  const opensslConf = process.platform === 'win32' ? 'NUL' : '/dev/null';

  exec(opensslCmd, { env: { ...process.env, OPENSSL_CONF: opensslConf } }, async (error) => {
    if (error) {
      console.error(`Error generating certificate: ${error.message}`);
      return res.status(500).json({ message: 'Failed to generate certificate.' });
    }

    try {
      const privateKey = fs.readFileSync(keyPath, 'utf8');
      const certificate = fs.readFileSync(certPath, 'utf8');

      // store privateKey in DB
      const connection = await pool.getConnection();
      const [result] = await connection.query(
        'INSERT INTO salesforce_orgs (name, email, companyName, city, state, instance_url, client_id, salesforce_api_jwt_private_key, salesforce_api_username, base_url, created_at, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)',
        [name, email, companyName, city, state, instanceUrl, clientId, privateKey, username, baseUrl, org_id]
      );
      console.log('insert id : '+result.insertId)
      await connection.query(
           'INSERT INTO org_drive_mappings (org_id, created_at) VALUES (?, NOW())',
           [result.insertId]
         );
      connection.release();

      res.set('Content-Disposition', 'attachment; filename="server.crt"');
      res.set('Content-Type', 'application/x-x509-ca-cert');
      res.status(200).send(certificate);

    } catch (dbError) {
      if((dbError.message).includes('Duplicate entry')){
            console.error(`Database error: ${dbError.message}`);
            return res.status(409).json({ message: 'Org is already registered' });

        }else{
            console.error(`Database error: ${dbError.message}`);
            return res.status(500).json({ message: 'Failed to save registration data.' });
        }
    }
  });
};

module.exports = {
  generateCertificate,
};
