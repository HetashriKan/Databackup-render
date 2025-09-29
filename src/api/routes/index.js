const express = require("express");
const authenticateSalesforceToken = require("../../middlewares/authenticateSalesforceToken");
const generateAccessToken = require("../controllers");
const jwt = require("jsonwebtoken");
const router = express.Router();
const { google } = require("googleapis");
const pool = require("../../../config/configuration");
const { randomUUID } = require("crypto");

let oauth2Client;
const Id = randomUUID();

router.use("/backup", require("./backup"));
router.use("/register", require("./register"));
router.use("/refresh-token", require("./refreshAccessToken"));

// /api/health
router.route("/health").get(async (req, res) => {
  // Health check – responds with 200 OK, service uptime, and DB status
  try {
    res.status(200).json({
      msg: "Hello World",
    });
  } catch (err) {
    res.status(400).json({
      msg: JSON.stringify(err),
      data: [],
    });
  }
});

// /api
router.route("/").get(async (req, res) => {
  try {
    res.status(200).json({
      msg: "Hello World",
    });
  } catch (err) {
    res.status(400).json({
      msg: JSON.stringify(err),
      data: [],
    });
  }
});

router.route("/token").get(authenticateSalesforceToken, async (req, res) => {
  if (req.user) {
    // VERIFY USER FROM DB

    const accessToken = await generateAccessToken(req.user);

    res.status(200).json({ token: accessToken }); // ,user : req.user
  } else {
    res.status(404).json({ msg: "user not found" });
  }
});

/**
 * GOOGLE OAUTH2 LOGIN FLOW
 */

// Assuming user has registered his org to our application

// Step 1: Redirect user to Google
let user;
router.get("/auth/google", async (req, res) => {
  console.log('1');
  const connection = await pool.getConnection();
  console.log('2');
  try {
    const { token, org_id } = req.query;
    console.log('3');
    console.log("token : ", token);
    console.log("token : @@ ", JSON.stringify(token));
    console.log("org_id@@@ " + org_id);
    const [orgDetails] = await connection.query(
      `
      SELECT o.client_id FROM salesforce_orgs o
      WHERE o.org_id = ? LIMIT 1`,
      [org_id]
    );
    console.log('4');
    console.log("orgDetails : ", orgDetails);
    console.log("orgDetails client id: ", orgDetails[0].client_id);
    user = jwt.verify(token, orgDetails[0].client_id);
    // user - clientId, clientSecret, orgId, orgbaseUrl -> drive_account
    console.log('5');
    console.log("user : ", user);
    console.log('6');
    
    if (user) {
      console.log('7');
      oauth2Client = new google.auth.OAuth2(
        user.clientId,
        user.clientSecret,
        // 'https://databackup-server.onrender.com/api/auth/google/callback'
        // "http://localhost:3000/api/auth/google/callback"
        "https://databackup-render.onrender.com/api/auth/google/callback"
      );
      console.log('8');
      const url = oauth2Client.generateAuthUrl({
        access_type: "offline", // get refresh_token
        prompt: "consent", // force consent each time (for dev)
        scope: ["profile", "email", "https://www.googleapis.com/auth/drive"],
      });
      console.log('9');
      // const connection = await pool.getConnection();
      await pool.query("USE databackup");
      console.log('10');
      const org_mapping_id = await pool
      .query(
        "select m.id as mappingId,m.org_id as orgId, o.org_id as salesforceOrgId,o.id as orgNo from org_drive_mappings m JOIN salesforce_orgs o ON o.id = m.org_id where o.org_id = ?",
        [user.iss]
      )
      .then((resulttt) => {
        console.log('11');
        console.log("org mapping resulttt : ", resulttt);
        return resulttt;
      })
      .catch((err) => {
          console.log('12');
          console.error("Error fetching org mapping:", err);
        });
        
        console.log("org mapping : ", org_mapping_id[0][0].mappingId);
        const [results] = await pool
        .query(
          `INSERT INTO drive_accounts (google_client_id, google_client_secret) VALUES (?, ?)`,
          [user.clientId, user.clientSecret]
        )
        .then((results) => {
          console.log('13');
          console.log("results", results);
          return results;
        })
        .catch((err) => {
          console.log('14');
          console.error("Error fetching org mapping:", err);
        });
        console.log("resultssss", results.insertId);
        console.log('15');
        const [mappingResult] = await pool
        .query("UPDATE org_drive_mappings SET drive_account_id = ?", [
          results.insertId,
        ])
        .then((mappingResult) => {
          console.log('16');
          console.log("mappingResult", mappingResult);
          return mappingResult;
        })
        .catch((err) => {
          console.log('17');
          console.error("Error fetching org mapping:", err);
        });
        // console.log("mappingResult", mappingResult);
        // if (orgDetails.length > 0) {
          // return res
          //   .status(400)
          //   .send({ message: "Drive Account Already Exists" });
          // } else {
            // const results = await connection.query(
              //   `INSERT INTO drive_accounts (salesforce_org_id, google_client_id, google_client_secret) VALUES (?, ?,?)`,
              //   [user.iss, user.clientId, user.clientSecret]
              // );
              console.log("stored successfully");
              console.log('18');
              if (results.length === 0) {
        console.log('19');
        throw new Error("Error Creating Drive Account");
      } else if (mappingResult.affectedRows === 0) {
        console.log('20');
        throw new Error("Error Creating Drive Account Mapping");
      } else {
        console.log('21');
        res.redirect(url);
        return;
      }
      // }
    }
  } catch (err) {
    if (err.message.includes("Duplicate entry")) {
      console.log('22');
      res.status(409).send("Google Drive account is already linked to the org");
    }
  } finally {
    connection.release();
  }
});

// Step 2: Google redirects back here with ?code=
// in response - we are getting token
router.get("/auth/google/callback", async (req, res) => {
  try {
    console.log('23');
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    console.log('24');
    
    // tokens contains access_token, refresh_token, expiry_date -> drive_accounts
    oauth2Client.setCredentials(tokens);
    console.log('25')
    console.log("Tokens:", tokens);
    console.log("Tokens access token:", tokens.access_token);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    console.log('26')
    const { data: profile } = await oauth2.userinfo.get();
    console.log('27')
    
    console.log("Google user:", profile);
    console.log("userrr", user);
    console.log("userrr orgid", user.iss);
    // console.log("Tokens:", tokens);
    console.log('28')
    const org_mapping = await pool
    .query(
      `select m.id as mappingId,m.org_id as orgId, o.org_id as salesforceOrgId,o.id as orgNo from org_drive_mappings m JOIN salesforce_orgs o ON o.id = m.org_id where o.org_id = ? `,
      [user.iss]
    )
    .then((resulttt) => {
        console.log('29')
        console.log("org mapping resulttt : ", resulttt);
        return resulttt;
      })
      .catch((err) => {
        console.log('30')
        console.error("Error fetching org mapping:", err);
      });
      
      console.log("org mapping : ", org_mapping);
      // const access_token = tokens.access_token;
      // const refresh_token = tokens.refresh_token;
      // const org_mapping_id = org_mapping[0][0].id;
      
      console.log("org mapping : ", org_mapping[0][0].mappingId);
      console.log("access token : ", tokens.access_token);
      console.log("refresh token : ", tokens.refresh_token);
      const results = await pool
      .query(
        `UPDATE drive_accounts d INNER JOIN org_drive_mappings m ON d.id = m.drive_account_id SET d.google_access_token = ?, d.google_refresh_token = ? WHERE m.org_id = ?`,
        [tokens.access_token, tokens.refresh_token, org_mapping[0][0].orgId]
      )
      .then((results) => {
        console.log('31')
        console.log("Stored token successfully");
        console.log("Stored token successfully", results);
        res.sendFile(__dirname + "/public/");
      })
      .catch((err) => {
        console.log('32')
        console.error("Error storing token:", err);
      });
      
      console.log('33')
      console.log("results after update: ", results);
      console.log("org mapping id : ", org_mapping[0][0].orgId);
      const [updatedRows] = await pool.query(
        `SELECT d.id as driveId, d.google_access_token as accessToken, d.google_refresh_token as refreshToken 
        FROM drive_accounts d 
        JOIN org_drive_mappings m ON d.id = m.drive_account_id
        WHERE m.org_id = ?`,
        [org_mapping[0][0].orgId]
      );
      
      console.log('34')
      console.log("updated rows : ", updatedRows);
      
      console.log("updated row : ", updatedRows[0].driveId);
      
      const mappingResult = await pool.query(
        "UPDATE org_drive_mappings m INNER JOIN drive_accounts d on d.id = m.drive_account_id SET m.drive_account_id = ? where m.org_id = ?",
        [updatedRows[0].driveId, org_mapping[0][0].mappingId]
      );
      console.log('35')
    } catch (err) {
    console.log('36')
    console.error("Google Auth Error:", err);
    res.status(401).json({ success: false, message: "Auth failed" });
  }
});


/**
 * Protected test route – list Drive files
 */
router.get("/drive", async (req, res) => {
  try {
    if (!oauth2Client.credentials.access_token) {
      return res.status(401).json({ msg: "Not authenticated with Google" });
    }

    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const result = await drive.files.list({
      pageSize: 10,
      fields: "files(id, name)",
    });

    res.json(result.data.files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// /api
router.route("/").get(authenticateSalesforceToken, async (req, res) => {
  try {
    if (req.user) {
      console.log("user : " + req.user);
      res.status(200).json({
        msg: "Hello World",
        user: req.user,
        verified: true,
      });
    } else {
      res.status(200).json({
        msg: "No User Was Verified",
      });
    }
  } catch (err) {
    res.status(400).json({
      msg: JSON.stringify(err),
      data: [],
    });
  }
});

module.exports = router;
