// PM2 Ecosystem Config — 4reels.cc
// Usage: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: '4reels',
      script: 'index.js',
      instances: 'max',       // use all CPU cores
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/err.log',
      out_file:   './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
