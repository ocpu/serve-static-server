#!/usr/bin/env node
'use strict'

const program = require('commander')
  .version(require('./package.json').version, '-v, --version')
  .usage('[options] [directory]')
  .option('-p, --port [port]', 'the port to use when serving', 5000)
  .option('-f, --404 [file]', 'show custom 404 page')
  .option('-l, --only-local', 'force to only serve on local device')
  .parse(process.argv)

const file404 = program[404]
const onlyLocal = program.onlyLocal

const mime = require('mime')
const colors = require('colors')

const { promisify } = require('util')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')

const readFile = promisify(fs.readFile)

// Get serve point and optional port
const port = program.port
const servePoint = path.resolve(program.args[0] || '.')

/**
 * 
 * @param {http.ClientRequest} req 
 * @param {*} res 
 */
const app = async (req, res) => {
  let fileToServe = servePoint + require('url').parse(req.url).pathname.replace(/\//g, path.sep)
  if (fileToServe.endsWith(path.sep))
    fileToServe += 'index.html'
  try {
    await serveFile(fileToServe, res, req)
  } catch (e) {
    if (file404) {
      try {
        await serveFile(file404, res, req)
      } catch (e) { resolveError(req, res, e, fileToServe) }
    } else { resolveError(req, res, e, fileToServe) }
  }
  logRequest(req, res.statusCode)
}

const resolveError = (req, res, e, file) => {
  if (e.code === 'ENOENT')
    console.error(`Could not find resource ${path.resolve(file)}`)
  else console.error(e)
  serveNotFound(req, res)
  logRequest(req, 404)
}

const logRequest = (req, status) => console.log(
  `[${colors.cyan('('+getBrowserFromAgent(req.headers['user-agent'])+')')} ` +
  `${colors.magenta(req.method)}/${colors[status >= 400 ? 'red' : status >= 300 ? 'blue' : 'green'](status)}] ${colors.underline(req.url)}`
)

/**
 * 
 * @param {string} file 
 * @param {ServerResponse} res 
 */
async function serveFile(file, res, req) {
  const etag = await getETag(file)
  if (etag === req.headers['if-none-match']) {
    res.statusCode = 304
    res.end()
    return
  }
  const { size } = fs.statSync(file)
  const encodingHeader = req.headers['accept-encoding']
  const encoding =
    ~encodingHeader.indexOf('gzip') ? 'gzip' :
    ~encodingHeader.indexOf('deflate') ? 'deflate' :
    'identity'
  const resContent =
    ~encodingHeader.indexOf('gzip') ? require('zlib').createGzip() :
    ~encodingHeader.indexOf('deflate') ? require('zlib').createDeflate() :
    res
  
  if (resContent !== res) resContent.pipe(res)
  const mimeType = getMimeType(file)
  if (mimeType)
    res.setHeader('Content-Type', mimeType)
  if (encoding === 'identity')
    res.setHeader('Content-Length', size)
  res.setHeader('ETag', etag)
  res.setHeader('Cache-Control', 'public, max-age=31536000')
  res.setHeader('Content-Encoding', encoding)
  res.setHeader('Vary', 'Accept-Encoding')
  res.statusCode = 200
  fs.createReadStream(file).pipe(resContent)
}

function serveNotFound(req, res) {
  const content = new Buffer(`Cannot ${req.method} ${req.url}`)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Length', content.byteLength)
  // res.statusCode = 404
  res.statusMessage = 'Not Found'
  res.end(content)
}

async function getETag(file) {
  return crypto.createHash('md5').update(await readFile(file)).digest('base64')
}

function getMimeType(file) {
  // First pass
  const mimeType = mime.getType(file)
  if (mimeType) return mimeType

  // Second pass
  const smallBuffer = Buffer.alloc(20)
  fs.readSync(fs.openSync(file, 'r'), smallBuffer, 0, smallBuffer.length, 0)
  const fileType = require('file-type')(smallBuffer)
  if (fileType) return fileType.mime

  // Default
  return 'text/plain'
}

const addresses = ['127.0.0.1']
if (!onlyLocal) Array.prototype.push.apply(addresses, discoverLocalAdresses())

const logListen = callAfter(addresses.length, () => {
  console.log(`Serving ${servePoint} on [ ${addresses.map(({ address, port }) => `http://${address}:${port}`).join(', ')} ]\n`)
})

/**
 * 
 * @param {string} agent 
 */
const getBrowserFromAgent = agent => 
  ~agent.indexOf('Chrome') ? 'Chrome' :
  ~agent.indexOf('Safari') ? 'Safari' :
  ~agent.indexOf('Firefox') ? 'Firefox' :
  ~agent.indexOf('MSIE') ? 'Internet Explorer' :
  ~agent.indexOf('Edge') ? 'Egde' :
  'Undefined'

addresses.forEach(function (address, index) {
  getPort(address, port, port => {
    require('http').createServer(app).listen(port, address).once('listening', function () {
      addresses[index] = {
        address,
        port
      }
      logListen()
    })
  })
})

function getPort(address, port, cb) {
  const server = require('http').createServer()
  server.once('listening', onListen)
  server.once('error', onError)
  server.listen(port, address)

  function onListen() {
    server.close()
    cb(port)
  }
  
  function onError() {
    server.removeAllListeners()
    server.close()
    getPort(port + 1, cb)
  }
}

function discoverLocalAdresses() {
  const os = require('os');
  const interfaces = os.networkInterfaces()
  const addresses = []
  for (const k in interfaces) {
    for (const k2 in interfaces[k]) {
      const address = interfaces[k][k2]
      if (address.family === 'IPv4' && !address.internal) {
        addresses.push(address.address)
      }
    }
  }
  return addresses
}

function callAfter(times, cb) {
  let calls = 0
  return function () {
    calls++
    if (calls >= times)
      cb()
  }
}
