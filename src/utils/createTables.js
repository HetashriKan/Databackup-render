const path = require("path");
const fs = require("fs");
const pool = require("../../config/configuration");
// const schema = require("../db/")
const createTables = () => {
  console.log("Now creating tables");
  const sqlPath = path.join(__dirname, "../db/schema.sql");
  console.log("after sqlPath");
  let sql = fs.readFileSync(sqlPath, "utf8");
  sql = sql.replace(/USE\s+\w+;/i, "");
  console.log("sql " + sql);
  const results = pool.query(sql);
  if (results.length === 0) {
    console.log("Error Creating Tables");
  } else {
    console.log("Tables created successfully");
  }
};

module.exports = createTables;
