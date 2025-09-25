const axios = require("axios");
const pool = require("../../../config/configuration");
const getOrgDetails = require("./../../utils/getOrgDetails")

const refreshAccessTokenController = async (req, res) => {
    const { salesforce_org_id } = req.body;
    // console.log("refreshToken ",refreshToken);
    console.log("salesforce_org_id ",salesforce_org_id);
    
    try {
        const connection = await pool.getConnection();
        console.log("before query");
        const [rows] = await connection.query(
            "SELECT d.google_client_id, d.google_client_secret, d.google_refresh_token FROM drive_accounts d JOIN org_drive_mappings m ON d.id = m.drive_account_id JOIN salesforce_orgs o ON o.id = m.org_id WHERE o.org_id = ? LIMIT 1",
            [salesforce_org_id]
        );
        console.log("after query");
        console.log("rows ",rows);
        const orgDetails = rows[0]; 
        console.log('orgDetails ', orgDetails);
        if (!orgDetails) {
            console.log('Salesforce Org not found');
            
            return res.status(404).send({ message: 'Salesforce Org not found' });
        }
        console.log("before response");
        const response = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
                client_id: orgDetails.google_client_id,
                client_secret: orgDetails.google_client_secret,
                refresh_token: orgDetails.google_refresh_token,
                grant_type: 'refresh_token',
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })

        // console.log("Google OAuth response status:", response.status);
        // console.log("Google OAuth response data:", response.data)
        
        console.log("response ",response);
        
        const { access_token, expires_in } = response.data;
        
        try {
            await connection.query(
                "UPDATE drive_accounts d JOIN org_drive_mappings m ON d.id = m.drive_account_id JOIN salesforce_orgs o ON o.id = m.org_id SET d.google_access_token = ? WHERE o.org_id = ?",
                [access_token, salesforce_org_id]
            );
            res.status(200).send({ message: 'Access token refreshed successfully', access_token, expires_in });
        } 
        catch (error) {
            res.status(500).send({ message: 'Database update failed' });
        }
        finally {
            connection.release();
        }
    }
    catch(error) {
        res.status(400).send({ message: 'Failed to refresh access token' });
    }
}

module.exports = refreshAccessTokenController;