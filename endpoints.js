const endpoints = [
    { method: 'GET', path: '/api', description: 'API home with service info and endpoints' },
    { method: 'GET', path: '/api/health', description: 'Service health check' },
    { method: 'POST', path: '/api/register', description: 'Register salesforce org' },
    { method: 'POST', path: '/api/register/verify', description: 'Verify registered salesforce org' },
    { method: 'POST', path: '/api/backup', description: 'Start a backup job' },
    { method: 'GET', path: '/api/backup/status', description: 'Get backup job status' },
    { method: 'GET', path: '/api/backup/files', description: 'List backup files' },
    { method: 'POST', path: '/api/restore', description: 'Initiate data restoration' },
    { method: 'GET', path: '/api/restore/status', description: 'Get restore job status' },
    { method: 'GET', path: '/api/restore/files', description: 'List restore files' },
    { method: 'POST', path: '/api/orgs', description: 'Register a Salesforce org' },
    { method: 'GET', path: '/api/orgs/:id', description: 'Get Salesforce org details' },
    { method: 'GET', path: '/api/settings', description: 'Get global settings' },
    { method: 'PUT', path: '/api/settings', description: 'Update global settings' },
    { method: 'GET', path: '/api/logs', description: 'Retrieve logs and audit trails' }
];

module.exports = endpoints;