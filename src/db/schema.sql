-- CREATE DATABASE databackup;

-- USE databackup;

CREATE TABLE salesforce_orgs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255),
  companyName VARCHAR(255),
  city VARCHAR(255),
  state VARCHAR(255),
  org_id VARCHAR(255) UNIQUE,
  instance_url VARCHAR(255),
  client_id VARCHAR(255),
  -- client_secret_ref VARCHAR(255),
  salesforce_api_jwt_private_key TEXT,
  salesforce_api_username VARCHAR(255),
  base_url VARCHAR(255),
  created_at DATETIME,
  status ENUM('ACTIVE', 'INACTIVE'),
  isProduction BOOLEAN
);

CREATE TABLE drive_accounts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  -- FOREIGN KEY (org_id) REFERENCES salesforce_orgs(org_id),
  -- salesforce_org_id VARCHAR(255),
  account_email VARCHAR(255),
  default_root_folder VARCHAR(255),
  google_client_id VARCHAR(255),
  google_client_secret VARCHAR(255),
  google_refresh_token VARCHAR(255),
  google_access_token VARCHAR(255),
  -- google_token_expiry DATETIME,
  created_at DATETIME,
  status VARCHAR(50)
);

CREATE TABLE org_drive_mappings (
  -- id CHAR(36) PRIMARY KEY,
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT,
  drive_account_id BIGINT,
  target_folder_id VARCHAR(255),
  created_at DATETIME,
  FOREIGN KEY (org_id) REFERENCES salesforce_orgs(id),
  FOREIGN KEY (drive_account_id) REFERENCES drive_accounts(id)
);

CREATE TABLE data_transfer_jobs (
  -- id CHAR(36) PRIMARY KEY,
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mappingId BIGINT,
  job_name VARCHAR(255),
  description TEXT,
  job_type ENUM('RESTORE', 'BACKUP'),
  start_time DATETIME,
  end_time DATETIME,
  status VARCHAR(50),
  total_objects INT,
  total_records BIGINT,
  total_bytes BIGINT,
  folderId VARCHAR(255),
  FOREIGN KEY (mappingId) REFERENCES org_drive_mappings(id),
  created_at DATETIME,
  updated_at DATETIME
);

CREATE TABLE data_transfer_object_log
(
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  data_transfer_job_id bigint,
  FOREIGN KEY (data_transfer_job_id) REFERENCES data_transfer_jobs(id),
  object_name VARCHAR(255),
  fields_count INT,
  estimated_size BIGINT,
  status TEXT,
  folderId VARCHAR(255),
  created_at DATETIME,
  updated_at DATETIME
);


CREATE TABLE error_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  backup_run_id BIGINT,
  timestamp DATETIME,
  level VARCHAR(50),
  component VARCHAR(255),
  message TEXT,
  metadata JSON,
  FOREIGN KEY (backup_run_id) REFERENCES data_jobs(id)
);
CREATE INDEX idx_sf_org_name ON salesforce_orgs (name);