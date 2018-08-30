'use strict';

var fs = require('fs'),
    union = require('union'),
    ecstatic = require('ecstatic'),
    httpProxy = require('http-proxy'),
    corser = require('corser');

//
// Remark: backwards compatibility for previous
// case convention of HTTP
//
exports.HttpServer = exports.HTTPServer = HttpServer;

/**
 * Returns a new instance of HttpServer with the
 * specified `options`.
 */
exports.createServer = function (options) {
  return new HttpServer(options);
};

/**
 * Constructor function for the HttpServer object
 * which is responsible for serving static files along
 * with other HTTP-related features.
 */
function HttpServer(options) {
  options = options || {};

  if (options.root) {
    this.root = options.root;
  }
  // else {
  //   try {
  //     fs.lstatSync('./public');
  //     this.root = './public';
  //   }
  //   catch (err) {
  //     this.root = './';
  //   }
  // }

  this.headers = options.headers || {};

  this.cache = options.cache === undefined ? 3600 : options.cache; // in seconds.
  this.showDir = options.showDir !== 'false';
  this.autoIndex = options.autoIndex !== 'false';
  this.showDotfiles = options.showDotfiles;
  this.gzip = options.gzip === true;
  this.contentType = options.contentType || 'application/octet-stream';

  if (options.ext) {
    this.ext = options.ext === true
      ? 'html'
      : options.ext;
  }

  var before = options.before ? options.before.slice() : [];

  before.push(function (req, res) {
    if (options.logFn) {
      options.logFn(req, res);
    }

    res.emit('next');
  });

  if (options.cors) {
    this.headers['Access-Control-Allow-Origin'] = '*';
    this.headers['Access-Control-Allow-Headers'] = 'Origin, X-Requested-With, Content-Type, Accept, Range';
    if (options.corsHeaders) {
      options.corsHeaders.split(/\s*,\s*/)
          .forEach(function (h) { this.headers['Access-Control-Allow-Headers'] += ', ' + h; }, this);
    }
    before.push(corser.create(options.corsHeaders ? {
      requestHeaders: this.headers['Access-Control-Allow-Headers'].split(/\s*,\s*/)
    } : null));
  }

  if (options.robots) {
    before.push(function (req, res) {
      if (req.url === '/robots.txt') {
        res.setHeader('Content-Type', 'text/plain');
        var robots = options.robots === true
          ? 'User-agent: *\nDisallow: /'
          : options.robots.replace(/\\n/, '\n');

        return res.end(robots);
      }

      res.emit('next');
    });
  }

  if(this.root){
    before.push(ecstatic({
      root: this.root,
      cache: this.cache,
      showDir: this.showDir,
      showDotfiles: this.showDotfiles,
      autoIndex: this.autoIndex,
      defaultExt: this.ext,
      gzip: this.gzip,
      contentType: this.contentType,
      handleError: typeof options.proxy !== 'string'
    }));
  }


  if (typeof options.proxy === 'string') {
    // console.log(options.apiPrefix);

    var proxy = httpProxy.createProxyServer({});
    proxy.on('error', function (err, req, res) {
      res.writeHead(500, {
        'Content-Type': 'text/plain'
      });
      res.end('Something went wrong. And we are reporting a custom error message: ' + err.message);
    });
    proxy.on('proxyRes', function (proxyRes, req, res) {
      proxyRes.headers['www-authenticate'] = 'None';
    });
    proxy.on('onProxyReq', (proxyReq, req, res) => {
      // add custom header to request
      // if(!proxyReq.getHeader('Authorization')){
      //   proxyReq.setHeader('Authorization', 'Basic YWRtaW46bmltZGE=');
      // }
      const cookie = proxyReq.getHeader('Cookie');
      if(cookie){
        proxyReq.setHeader('Cookie', cookie.replace('proxy_api_url=', 'proxy_temp_api_url='));
      }
    });
    before.push(function (req, res) {
      let proxyUrl = options.proxy;
      let headers;
      // console.log(options.apiPrefix, req.url.match(options.apiPrefix));
      if(options.apiPrefix && req.url.match(options.apiPrefix) && req.headers.cookie){
        const res = /proxy_api_url=([^;]+)(;.*|$)/.exec(req.headers.cookie);
        if(res && res[1]) {
          // console.log(res);
          proxyUrl = res[1];
          const hostsRes = /proxy_api_hosts=([^;]+)(;.*|$)/.exec(req.headers.cookie);
          if(hostsRes && hostsRes[1]) {
            const [ip, host] = hostsRes[1].trim().split(/\s+/);
            if(ip && host){
              proxyUrl = proxyUrl.replace(host, ip);
              headers = 
                {'Host': host}
              ;
            }
          }
        }
      }
      console.log(proxyUrl, headers);
      proxy.web(req, res, {
        target: proxyUrl,
        changeOrigin: true,
        secure: false,
        ws: true,
        headers,
      });
    });
  }

  var serverOptions = {
    before: before,
    headers: this.headers,
    onError: function (err, req, res) {
      if (options.logFn) {
        options.logFn(req, res, err);
      }

      res.end();
    }
  };

  if (options.https) {
    serverOptions.https = options.https;
  }

  this.server = union.createServer(serverOptions);
}

HttpServer.prototype.listen = function () {
  this.server.listen.apply(this.server, arguments);
};

HttpServer.prototype.close = function () {
  return this.server.close();
};
