#!/usr/bin/env node
'use strict'

// Node modules
const path = require('path')
const fs = require('fs')


// Variables
const program = require('commander')
  .version(require('./package.json').version, '-v, --version')
  .usage('[options] [directory]')
  .option('-p, --port [port]', 'the port to use when serving', 5000)
  .option('-f, --404 [file]', 'show custom 404 page')
  .option('-l, --only-local', 'force to only serve on local device')
  .option('-c, --cert [file]', 'certificate file')
  .option('-k, --key [file]', 'certificate key file')
  .option('-s, --secure', 'use a secure connection https or secure http2')
  .option('-h2, --http2', 'use http2')
  .parse(process.argv)

// Program options
const port = program.port
const file404 = program[404]
const onlyLocal = program.onlyLocal
const servePoint = path.resolve(program.args[0] || '.')
const cert = program.cert
const key = program.key
const secure = program.secure
const http2 = program.http2

const serverType = http2 ? 'http2' : 'http'
const secureOptions = {
  allowHTTP1: true,
  cert,
  key
}

if (secure && (cert === void 0 || key === void 0)) {
  console.error('The key and cert option must be pressent to use ' + serverType)
  process.exit(1)
}

if (cert) {
  try {
    fs.statSync(cert)
  } catch (e) {
    if (e.code === 'ENOENT')
      console.error('certificate file does not exist')
    process.exit(1)
  }
}

if (key) {
  try {
    fs.statSync(key)
  } catch (e) {
    if (e.code === 'ENOENT')
      console.error('key file does not exist')
    process.exit(1)
  }
}

const app = require('./' + serverType)(servePoint, file404)

// Get addresses to serve
const addresses = ['127.0.0.1']
if (!onlyLocal) addresses.concat(discoverLocalAdresses())

const servers = new Array(addresses.length)

const logListen = callAfter(addresses.length, () =>
  console.log(`Serving ${servePoint} on [ ${addresses.map(({ address, port }) => `http://${address}:${port}`).join(', ')} ]\n`)
)

const createServer = 
  secure ? 
    http2 ? 
      require('http2').createSecureServer :
      require('https').createServer :
    http2 ?
      require('http2').createServer :
      require('http').createServer


// For every address listen to the avaliable port
addresses.forEach(function (address, index) {
  getPort(address, port, port => {
    servers[index] = createServer(...[secure ? secureOptions : app, app]).listen(port, address).once('listening', () => {
      addresses[index] = { address, port }
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

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  servers.forEach(server => {
    server.close()
  })
  process.exit()
})
