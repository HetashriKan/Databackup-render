const createNewFile = (backupName, objectName, salesforce_org_id, filePart, tempDir, currentFilePath, currentWriteStream, currentCsvStream, recordsInCurrentFile) => {
  const fileName = `EWDB_${backupName}_${objectName}_${salesforce_org_id}_${Date.now()}_part_${filePart}.csv`;
  currentFilePath = path.join(tempDir, fileName);
  currentWriteStream = fs.createWriteStream(currentFilePath);
  currentCsvStream = csv.format({ headers: true });
  currentCsvStream.pipe(currentWriteStream);
  recordsInCurrentFile = 0;

  return {
    currentFilePath,
    currentWriteStream,
    currentCsvStream,
    recordsInCurrentFile,
  };
};

module.exports = createNewFile;

