
class Logger {
    constructor(config) {
      this.config = config || {};
      this.logging = this.config.logging || {};
      this.source = this.logging.source || 'jwt-pizza-service';
      this.MAX_LEN = 5000; // cap size so logs don’t explode
    }
  
    
    httpLogger = (req, res, next) => {
      const originalSend = res.send.bind(res);
  
      res.send = (body) => {
        try {
          const logData = {
            authorized: !!req.headers.authorization,
            path: req.originalUrl || req.path,
            method: req.method,
            statusCode: res.statusCode,
            reqBody: this.previewBody(req.body),
            resBody: this.previewBody(body),
          };
          const level = this.statusToLogLevel(res.statusCode);
          this.log(level, 'http', logData);
        } catch (e) {
          console.log('Error logging HTTP request:', e);
        }
  
        res.send = originalSend;
        return res.send(body);
      };
  
      next();
    };
  
   
    dbLogger(sql, params) {
      const logData = {
        sql,
        params: this.previewBody(params),
      };
      this.log('info', 'db', logData);
    }
  
   
    factoryLogger(info) {
      this.log('info', 'factory', info);
    }
  
  
    unhandledErrorLogger(err) {
      const logData = {
        name: err?.name,
        message: err?.message,
        stack: err?.stack,
      };
      this.log('error', 'unhandledError', logData);
    }
  
  
    log(level, type, logData) {
      const labels = {
        component: this.source,
        level,
        type,
      };
      const values = [this.nowString(), this.sanitize(logData)];
      const event = { streams: [{ stream: labels, values: [values] }] };
  
      this.sendLogToGrafana(event).catch(() => {
        
      });
    }
  
    statusToLogLevel(statusCode) {
      if (statusCode >= 500) return 'error';
      if (statusCode >= 400) return 'warn';
      return 'info';
    }
  
    nowString() {
      
      return (Math.floor(Date.now()) * 1_000_000).toString();
    }
  
 
  
    previewBody(body) {
      if (body == null) return null;
      if (typeof body === 'string') {
        return body.length > this.MAX_LEN
          ? body.slice(0, this.MAX_LEN) + '…[truncated]'
          : body;
      }
      
      if (typeof body === 'object' && typeof body.pipe === 'function') {
        return '[stream body]';
      }
      return body; // objects handled in sanitize()
    }
    // stuf to clean out so it is not visbile
    sanitize(data) {
      const SENSITIVE_KEYS = new Set([
        'password',
        'pass',
        'pwd',
        'authorization',
        'auth',
        'token',
        'access_token',
        'refresh_token',
        'apiKey',
        'apikey',
        'secret',
        'client_secret',
        'ssn',
        'card',
        'creditcard',
        'jwt',
      ]);
  
      const redact = (value) => {
        if (value == null) return value;
  
        if (typeof value === 'string') {
          // Trim giant strings
          if (value.length > this.MAX_LEN) {
            return value.slice(0, this.MAX_LEN) + '…[truncated]';
          }
          return value;
        }
  
        if (Array.isArray(value)) {
          return value.map(redact);
        }
  
        if (typeof value === 'object') {
          const out = {};
          for (const [key, val] of Object.entries(value)) {
            if (SENSITIVE_KEYS.has(key.toLowerCase())) {
              out[key] = '*****';
            } else {
              out[key] = redact(val);
            }
          }
          return out;
        }
  
        return value;
      };
  
      try {
        const safe = redact(data);
        return JSON.stringify(safe);
      } catch {
        return JSON.stringify('[Unserializable log data]');
      }
    }
  
    //Grafana sendings
  
    async sendLogToGrafana(event) {
        if (process.env.NODE_ENV === 'test') {
            return;
          }
      if (
        !this.logging ||
        !this.logging.url ||
        !this.logging.userId ||
        !this.logging.apiKey
      ) {
        return;
      }
  
      const body = JSON.stringify(event);
  
      const res = await fetch(this.logging.url, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.logging.userId}:${this.logging.apiKey}`,
        },
      });
  
      if (!res.ok) {
        console.log('Failed to send log to Grafana');
      }
    }
  }
  
  module.exports = Logger;
  