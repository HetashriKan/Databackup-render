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
  const connection = await pool.getConnection();
  try {
    const { token, org_id } = req.query;
    console.log("token : ", token);
    console.log("token : @@ ", JSON.stringify(token));
    console.log("org_id@@@ " + org_id);
    const [orgDetails] = await connection.query(
      `
      SELECT o.client_id FROM salesforce_orgs o
      WHERE o.org_id = ? LIMIT 1`,
      [org_id]
    );
    console.log("orgDetails : ", orgDetails);
    console.log("orgDetails client id: ", orgDetails[0].client_id);
    user = jwt.verify(token, orgDetails[0].client_id);
    // user - clientId, clientSecret, orgId, orgbaseUrl -> drive_account
    console.log("user : ", user);

    if (user) {
      oauth2Client = new google.auth.OAuth2(
        user.clientId,
        user.clientSecret,
        // 'https://databackup-server.onrender.com/api/auth/google/callback'
        // 'http://localhost:3000/api/auth/google/callback'
        "https://databackup-render.onrender.com/api/auth/google/callback"
      );
      const url = oauth2Client.generateAuthUrl({
        access_type: "offline", // get refresh_token
        prompt: "consent", // force consent each time (for dev)
        scope: ["profile", "email", "https://www.googleapis.com/auth/drive"],
      });
      const connection = await pool.getConnection();
      const [orgDetails] = await connection.query(
        // "SELECT salesforce_org_id FROM drive_accounts WHERE salesforce_org_id = ?",
        // [user.iss]
        "SELECT o.org_id FROM salesforce_orgs o JOIN org_drive_mappings m ON o.id = m.org_id JOIN drive_accounts d ON d.id = m.drive_account_id WHERE o.org_id = ?",
        [org_id]
      );

      // if (orgDetails.length > 0) {
      // return res
      //   .status(400)
      //   .send({ message: "Drive Account Already Exists" });
      // } else {
      const results = await connection.query(
        `
          INSERT INTO drive_accounts (google_client_id, google_client_secret)
          SELECT ?, ?
          FROM salesforce_orgs o
          WHERE o.org_id = ?
          `,
        [user.clientId, user.clientSecret, user.iss]
      );
      console.log("stored successfully");
      if (results.length === 0) {
        throw new Error("Error Creating Drive Account");
      } else {
        res.redirect(url);
        return;
      }
      // }
    }
  } catch (err) {
    console.log(err);
  } finally {
    connection.release();
  }
});

// Step 2: Google redirects back here with ?code=
// in response - we are getting token
router.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);

    // tokens contains access_token, refresh_token, expiry_date -> drive_accounts
    oauth2Client.setCredentials(tokens);
    console.log("Tokens:", tokens);
    console.log("Tokens access token:", tokens.access_token);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    console.log("Google user:", profile);
    console.log("userrr", user);
    console.log("userrr orgid", user.iss);
    // console.log("Tokens:", tokens);
    const results = await pool
      .query(
        `
  UPDATE drive_accounts d
  JOIN org_drive_mappings m ON m.drive_account_id = d.id
  JOIN salesforce_orgs o ON o.id = m.org_id
  SET d.google_access_token = ?, d.google_refresh_token = ?
  WHERE o.org_id = ?
  `,
        [tokens.access_token, tokens.refresh_token, user.iss]
      )
      .then((results) => {
        console.log("Stored token successfully");
        res.sendFile(__dirname + "/public/");
      })
      .catch((err) => {
        console.error("Error storing token:", err);
      });
  } catch (err) {
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
