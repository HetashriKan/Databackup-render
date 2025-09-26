const swaggerJSON = require("./swagger.json");
const home = require("./endpoints/home/home.json");
const backup = require("./endpoints/backup/backup.json");
const backupSyncStatus = require("./endpoints/backup/syncStatus.json");
const backupShareFile = require("./endpoints/backup/shareFile.json");
const register = require("./endpoints/register/register.json");
const registerVerify = require("./endpoints/register/registerVerify.json");
const restore = require("./endpoints/restore/restore.json");
const log = require("./endpoints/log/log.json");

console.log('@@@ backup::'+backup["/api/backup"])
const tags = require("./tags.json");
swaggerJSON.tags = tags;

swaggerJSON.paths["/api"] = home["/api"];
swaggerJSON.paths["/api/health"] = home["/api/health"];
swaggerJSON.paths["/api/backup"] = backup["/api/backup"];
swaggerJSON.paths["/api/backup/sync-status"] = backupSyncStatus["/api/backup/sync-status"];
swaggerJSON.paths["/api/google-drive/backup/share-file"] = backupShareFile["/api/google-drive/backup/share-file"];
swaggerJSON.paths["/api/register"] = register["/api/register"];
swaggerJSON.paths["/api/register/verify"] = registerVerify["/api/register/verify"];
swaggerJSON.paths["/api/restore"] = restore["/api/restore"];
swaggerJSON.paths["/api/google-drive/restore/files"] = restore["/api/google-drive/restore/files"];
swaggerJSON.paths["/api/google-drive/restore/record"] = restore["/api/google-drive/restore/record"];
swaggerJSON.paths["/api/error-log/create"] = log["/api/error-log/create"];
swaggerJSON.paths["/api/error-log/fetch"] = log["/api/error-log/fetch"];

module.exports = swaggerJSON;