const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = path.resolve(__dirname, '../../data/logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
      return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
    })
  ),
  transports: [
    new transports.File({
      filename: path.join(logDir, 'tunnel.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new transports.Console({
      format: format.combine(format.colorize(), format.simple()),
    }),
  ],
});

module.exports = logger;
