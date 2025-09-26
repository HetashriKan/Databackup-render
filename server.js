const express = require("express");
const router = express.Router();

const app = express();
const fs = require("fs");
const cors = require("cors");
require("dotenv").config();
const endpoints = require("./endpoints");
const pool = require("./config/configuration");
const createTables = require("./src/utils/createTables");
const swaggerUi = require('swagger-ui-express');


// const swaggerUi = require('swagger-ui-express');
// const swaggerDocument = require('./swagger.json');

app.use(express.json());
const corsOptions = {
  origin: 'https://power-ruby-472.scratch.lightning.force.com',
  // origin: '*',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
// app.options('*', cors(corsOptions));

app.get("/", (req, res) => {
  res.json({
    status: "success",
    data: {
      endpoints,
    },
    message: "Salesforce Backup and Restore API",
    timestamp: new Date(),
  });
});


app.use(router);

app.use("/api", require("./src/api/routes"));
const swaggerJSON = require("./swagger/swaggerPath");

var options = {
  explorer: true,
};


app.use("/api-docs/", swaggerUi.serve);
app.get(
  "/api-docs/",
  swaggerUi.setup(swaggerJSON, options)
);


// app.use(function (err, req, res, next) {
//   if (err instanceof ValidationError) {
//     return res.status(400).json({
//       msg: err.details.body[0]["message"]
//     });
//   }

//   return res.status(500).json(err);
// });

// if no routes found, catch 404 and return error response
// app.use(function (req, res) {
//   return res.status(404).json({
//     msg: "No such endpoint exists"
//   });
// });

async function testConnection() {
  try {
    const dbName = process.env.MYSQL_DATABASE;

    // Check if database exists
    const [results] = await pool.query(`SHOW DATABASES LIKE '${dbName}'`);
    if (results.length === 0) {
      console.log("Database does not exist, creating...");
      await pool.query(`CREATE DATABASE \`${dbName}\``);
      console.log("Database created successfully");
    }

    // Switch to new database
    const conn = await pool.getConnection();
    await conn.changeUser({ database: dbName });

    // Check if table exists
    const [tableResults] = await conn.query(
      `SHOW TABLES LIKE 'salesforce_orgs'`
    );
    if (tableResults.length === 0) {
      console.log("Tables do not exist, creating tables...");
      await createTables(conn);
    } else {
      console.log("Database and tables already exist.");
    }

    conn.release();
    console.log("Database connected successfully");
  } catch (err) {
    console.error("Database connection failed:", err);
  }
}

testConnection();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Salesforce backup server listening on port ${PORT}`);
});
