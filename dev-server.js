#!/usr/bin/env node
'use strict'

// Native modules
const { createGzip, createDeflate } = require('zlib')
const { createHash } = require('crypto')
const { promisify } = require('util')
const path = require('path')
const url = require('url')
const fs = require('fs')

// NPM modules
const mime = require('mime')
const fileType = require('file-type')
const colors = require('colors')

// Variables
const readFile = promisify(fs.readFile)
const exists = promisify(fs.exists)
const read = promisify(fs.read)
const open = promisify(fs.open)
const program = require('commander')
  .version(require('./package.json').version, '-v, --version')
  .usage('[options] [directory]')
  .option('-p, --port [port]', 'the port to use when serving', 5000)
  .option('-f, --404 [file]', 'show custom 404 page')
  .option('-l, --only-local', 'force to only serve on local device')
  .parse(process.argv)

// Program options
const port = program.port
const file404 = program[404]
const onlyLocal = program.onlyLocal
const servePoint = path.resolve(program.args[0] || '.')


const app = async (req, res) => {
  // Get file to serve
  let fileToServe = servePoint + url.parse(req.url).pathname.replace(/\//g, path.sep)
  // If the path ends with / or \ append index.html
  if (fileToServe.endsWith(path.sep))
    fileToServe += 'index.html'

  try {
    await serveFile(fileToServe, res, req.headers)
  } catch (e) {
    await serveNotFound(e, fileToServe, req, res)
  }

  const status = res.statusCode
  const { method, url: path, headers } = req
  const browser = colors.cyan('(' + getBrowserFromAgent(headers['user-agent']) + ')')
  const requestMethod = colors.magenta(method)
  const statusCode = colors[
    status >= 400 ? 'red' :
    status >= 300 ? 'blue' :
    'green'
  ](status)
  console.log(`[${browser} ${requestMethod}/${statusCode}] ${colors.underline(path)}`)
}

async function serveFile(file, res, headers) {
  // Test browser cache
  const etag = await getETag(file)
  if (etag === headers['if-none-match']) {
    res.statusCode = 304
    res.end()
    return
  }

  // Set content encoding
  const encodingHeader = headers['accept-encoding']
  const [encoding, stream] =
    ~encodingHeader.indexOf('gzip') ? ['gzip', createGzip] :
    ~encodingHeader.indexOf('deflate') ? ['deflate', createDeflate] :
    ['identity', res]

  if (stream !== res) stream.pipe(res)
  if (encoding === 'identity') res.setHeader('Content-Length', fs.statSync(file).size)
  res.setHeader('Content-Encoding', encoding)

  // Set mime type
  const mimeType = await getMimeType(file)
  if (mimeType) res.setHeader('Content-Type', mimeType)
  
  // Caching
  res.setHeader('ETag', etag)
  res.setHeader('Cache-Control', 'public, max-age=31536000')

  res.setHeader('Vary', 'Accept-Encoding')
  res.statusCode = res.statusCode || 200
  fs.createReadStream(file).pipe(stream)
}

async function serveNotFound(e, file, req, res) {
  res.statusCode = 404
  if (!file404 && await exists(file404)) {
    const content = new Buffer(`Cannot ${req.method} ${req.url}`)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Length', content.byteLength)
    res.setHeader('Content-Encoding', 'identity')
    res.end(content)
  } else await serveFile(file404, res, req.headers)
  
  // Log error to console
  if (e.code === 'ENOENT')
    console.error(`Could not find resource ${path.resolve(file)}`)
  else console.error(e)
}

const getETag = async file =>
  createHash('md5').update(await readFile(file)).digest('base64')

async function getMimeType(file) {
  // First pass
  const mimeType = mime.getType(file)
  if (mimeType) return mimeType

  // Second pass
  const smallBuffer = Buffer.alloc(20)
  const fd = await open(file, 'r')
  await read(fd, smallBuffer, 0, smallBuffer.length, 0)
  fs.close(fd)
  const type = fileType(smallBuffer)
  if (type) return type.mime

  // Default
  return 'text/plain'
}

// Get addresses to serve
const addresses = ['127.0.0.1']
if (!onlyLocal) addresses.concat(discoverLocalAdresses())

const logListen = callAfter(addresses.length, () =>
  console.log(`Serving ${servePoint} on [ ${addresses.map(({ address, port }) => `http://${address}:${port}`).join(', ')} ]\n`)
)

const getBrowserFromAgent = agent => 
  ~agent.indexOf('Chrome') ? 'Chrome' :
  ~agent.indexOf('Safari') ? 'Safari' :
  ~agent.indexOf('Firefox') ? 'Firefox' :
  ~agent.indexOf('Edge') ? 'Egde' :
  ~agent.indexOf('MSIE') ? 'Internet Explorer' :
  'Undefined'

// For every address listen to the avaliable port
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

function* networkInterfaces() {
  const interfaces = require('os').networkInterfaces()
  for (const name in interfaces)
    yield [ name, interfaces[name] ]
}

function discoverLocalAdresses() {
  const addresses = []
  for (const [, iface] of networkInterfaces()) for (const { address, family, internal } of iface)
    if (family === 'IPv4' && !internal) addresses.push(address)
  return addresses
}

const callAfter = (times, cb, calls = 0) => () =>
  ++calls >= times && cb()
